import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { ZodError } from "zod";

import { pointKeys, pointKeyStates } from "@bms/db";
import type { BmsDb } from "@bms/db";
// From `@bms/shared` itself: ADR 0099 Amendment 13 makes both bodies copilot catalog entries
// (PR 3), and `tests/f3.85-catalog-coverage` requires the very export a service parses.
import { createPointKeyStateBodySchema, updatePointKeyStateBodySchema } from "@bms/shared";
import type { AdminPointKeyStateDto, AdminPointKeyStatesListResponse, JwtPayload, PointKeyStateTone } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
import { MasterDataAuditService } from "../master-data-audit.service";
import { isSeededPointKeyState } from "./point-key-states.pure";

type StateRow = typeof pointKeyStates.$inferSelect;

/**
 * `F4.309` / ADR 0088 Amendment 3 — the state labels of switching points
 * (`bms.point_key_states`), managed in the portal.
 *
 * **Why `fleetDb` and only `fleetDb` (AGENTS.md §4.3).** The table has no `organization_id`, no
 * row-level security and no policy (migration `0097`): it is fleet-wide master data, like
 * `bms.point_keys`. A tenant GUC has nothing to scope, and `bms_tenant` holds no `INSERT`,
 * `UPDATE` or `DELETE` on it (`0097`'s `REVOKE`, which decision 2 keeps). So every read and write
 * runs on `bms_fleet`, and each write in one transaction with its audit row, `organizationId: null`
 * — the fleet-event case ADR 0043 Amendment 5 admits `TO bms_fleet` (`PointKeysAdminService`).
 *
 * **The gate order is the plan's C7, in every method:** `requireGlobalAdmin` (403) → the body
 * (400, `parseBody`) → the row (404) → the seeded pair (409). The body is
 * parsed here, after the gate, so a tenant administrator learns nothing about the shape of a write
 * they may not make. The list is the global admin's too (owner ruling Q1 (a)); everyone else reads
 * the rows through `GET /vocabularies` (`switchingStates`).
 *
 * **The seeded rows are read-only (decision 3).** A pair of `POINT_KEY_STATE_SEED` answers
 * `seeded: true`, and a `PATCH`, a `DELETE` or a `POST` of one is 409: the seed writes them
 * `ON CONFLICT DO UPDATE`, so an edit would quietly revert on the next `pnpm db:seed`.
 */
@Injectable()
export class PointKeyStatesAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Every row, ordered by point key then value, each with `seeded`. */
  async list(jwt: JwtPayload): Promise<AdminPointKeyStatesListResponse> {
    await this.requireGlobalAdmin(jwt);
    const rows = await this.fleetDb
      .select()
      .from(pointKeyStates)
      .orderBy(asc(pointKeyStates.pointKeyCode), asc(pointKeyStates.value));
    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Creates a row for an active point key; a seeded pair is 409, an unknown or retired key 400. */
  async create(jwt: JwtPayload, input: unknown): Promise<AdminPointKeyStateDto> {
    await this.requireGlobalAdmin(jwt);
    const body = parseBody(createPointKeyStateBodySchema.safeParse(input));
    const pair = describePair(body.pointKey, body.value);
    if (isSeededPointKeyState(body.pointKey, body.value)) {
      throw new ConflictException(`The state label ${pair} is seeded and read-only`);
    }

    const [key] = await this.fleetDb
      .select({ active: pointKeys.active })
      .from(pointKeys)
      .where(eq(pointKeys.code, body.pointKey))
      .limit(1);
    if (!key || !key.active) {
      throw new BadRequestException(`Point key "${body.pointKey}" is not an active point key`);
    }

    const created = await translateConstraintErrors(
      () =>
        this.fleetDb.transaction(async (tx) => {
          const [row] = await tx
            .insert(pointKeyStates)
            .values({ pointKeyCode: body.pointKey, value: body.value, label: body.label, tone: body.tone })
            .returning();
          await this.audit.write(
            {
              actor: jwt,
              action: "master.point_key_state.create",
              entityType: "point_key_state",
              entityId: row!.id,
              organizationId: null,
              payload: body,
            },
            tx,
          );
          return row!;
        }),
      {
        onUnique: () => new ConflictException(`A state label for ${pair} already exists`),
        // The key was read active a moment ago; a concurrent delete of it lands here.
        onForeignKey: () => new BadRequestException(`Point key "${body.pointKey}" is not an active point key`),
      },
    );
    return this.mapRow(created);
  }

  /** Changes the label or the tone (only the named fields); a seeded row is 409. */
  async update(jwt: JwtPayload, id: string, input: unknown): Promise<AdminPointKeyStateDto> {
    await this.requireGlobalAdmin(jwt);
    const body = parseBody(updatePointKeyStateBodySchema.safeParse(input));
    if (body.label === undefined && body.tone === undefined) {
      throw new BadRequestException("Name a label or a tone to change");
    }
    const current = await this.fetchRow(id);
    this.refuseSeeded(current);

    const updated = await this.fleetDb.transaction(async (tx) => {
      // Only the named fields: a merge over the row read above would undo a concurrent edit of
      // the other field (the `PointKeysAdminService.update` lesson).
      const [row] = await tx.update(pointKeyStates).set(body).where(eq(pointKeyStates.id, id)).returning();
      if (!row) {
        throw new NotFoundException("State label not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key_state.update",
          entityType: "point_key_state",
          entityId: id,
          organizationId: null,
          payload: body,
        },
        tx,
      );
      return row;
    });
    return this.mapRow(updated);
  }

  /** Deletes a row; a seeded row is 409. */
  async remove(jwt: JwtPayload, id: string): Promise<void> {
    await this.requireGlobalAdmin(jwt);
    const current = await this.fetchRow(id);
    this.refuseSeeded(current);

    await this.fleetDb.transaction(async (tx) => {
      const [row] = await tx.delete(pointKeyStates).where(eq(pointKeyStates.id, id)).returning();
      if (!row) {
        throw new NotFoundException("State label not found");
      }
      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key_state.delete",
          entityType: "point_key_state",
          entityId: id,
          organizationId: null,
          // What was removed, so the audit log can say which label went.
          payload: { pointKey: row.pointKeyCode, value: row.value, label: row.label, tone: row.tone },
        },
        tx,
      );
    });
  }

  /**
   * The only gate on a fleet-wide vocabulary, as `PointKeysAdminService.requireGlobalAdmin`:
   * `requireMasterDataUser` turns the JWT into a `bms.users` row and refuses `operator` and
   * `viewer`; `isGlobalAdmin` then refuses every tenant administrator.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(
        "State labels are fleet-wide master data — only a global administrator may manage them",
      );
    }
  }

  private refuseSeeded(row: StateRow): void {
    if (isSeededPointKeyState(row.pointKeyCode, row.value)) {
      throw new ConflictException(`The state label ${describePair(row.pointKeyCode, row.value)} is seeded and read-only`);
    }
  }

  private async fetchRow(id: string): Promise<StateRow> {
    const [row] = await this.fleetDb.select().from(pointKeyStates).where(eq(pointKeyStates.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException("State label not found");
    }
    return row;
  }

  private mapRow(row: StateRow): AdminPointKeyStateDto {
    return {
      id: row.id,
      pointKey: row.pointKeyCode,
      value: row.value,
      label: row.label,
      // Narrowed, not parsed: `point_key_states_tone_check` (`0109`) bounds it to the five.
      tone: row.tone as PointKeyStateTone,
      seeded: isSeededPointKeyState(row.pointKeyCode, row.value),
    };
  }
}

/**
 * A refused body is a 400 with the flattened issues — the `UsersAdminService` idiom: a
 * `safeParse`, so no `ZodError` escapes a service (`tests/f4.108-service-parses-are-guarded`).
 */
function parseBody<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}

/** `"breaker_main" = 1` — the pair a 409 names. */
function describePair(pointKey: string, value: number): string {
  return `"${pointKey}" = ${value}`;
}
