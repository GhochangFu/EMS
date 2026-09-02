import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { assetRoles } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AssetRoleDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateAssetRoleBody, UpdateAssetRoleBody } from "./asset-roles.schema";

/**
 * `F3.40` / ADR 0051 decision 5 — the write path for `bms.asset_roles`.
 *
 * **Why a write path at all.** Migration `0051` seeded 26 codes and `0060` adds
 * two more, and both are releases. ADR 0051 decision 1 rules that a stock
 * template must resolve for every organization *present and future*, which
 * means the vocabulary a template names has to be able to grow without one. The
 * codes are the migration; this service is the half that stops the next shape
 * needing a deploy.
 *
 * **`fleetDb`, and there is no tenant alternative.** `bms.asset_roles` has no
 * `organization_id`, no policy and no FORCE flag — it is a member of the
 * global-vocabulary class beside `bms.alarm_skills`, `bms.dashboard_sections`
 * and, since `0057`, `bms.point_keys`. `withTenant` would set
 * `app.current_organization` for a policy that does not exist and claim a
 * tenant the row does not have. The audit row is org-less for the same reason,
 * which is the case ADR 0043 Amendment 5 carved out: `NULL` is admitted
 * `TO bms_fleet` and refused `TO bms_tenant`.
 *
 * **NO GRANT REVOKE IS OWED HERE, and the rule says so on its own terms.**
 * AGENTS.md §4.4 states that a platform-vocabulary table has no policy, so its
 * GRANTS are its only containment, and that they must be narrowed *the moment
 * it grows a tenant-pool writer* — which is why migration `0059` revoked
 * `UPDATE` and `DELETE` on `bms.point_keys` from `bms_tenant` once
 * `OnboardingCommitService` began inserting inside `withTenant`. This route
 * writes on `FLEET_DRIZZLE` and nothing anywhere writes `bms.asset_roles` on
 * the tenant connection, so `bms_tenant`'s default-privilege grant from
 * `0041:112` stays exactly as harmless as it was before this file existed.
 * **A future writer on the tenant pool changes that answer**, and the revoke
 * becomes owed in the same migration that adds it.
 *
 * **GATED TO THE GLOBAL `admin` ROLE, WHICH IS THE WHOLE SECURITY ARGUMENT.**
 * A global table has no policy, so its GRANTS are its only containment — and a
 * grant cannot tell one authenticated writer from another. If a tenant
 * administrator could reach this route, they could retire `transformer` for
 * every organization on the fleet. ADR 0046 made that argument for audit
 * *reads*; ADR 0051 decision 5 makes it for these *writes*, and `F3.39` already
 * applied it to `PointKeysAdminService`.
 *
 * **What this service deliberately does NOT do.**
 *
 * - **No delete.** `asset_group_members_role_fkey` carries no `ON DELETE` by
 *   design (`0051` step 3), so a code in use cannot be removed and a code not
 *   in use still should not be — a membership may hold it tomorrow.
 *   Retirement is `PATCH { active: false }`, and
 *   `VocabulariesService.list` already filters `active = true`, so every
 *   picker follows without a second filter.
 * - **No rename.** `code` is the primary key and the FK target; see
 *   `asset-roles.schema.ts`.
 * - **No check that a retired code is unused.** Retiring a role that plant
 *   still references is the intended operation, not an accident: the
 *   memberships keep their value and the FK keeps holding, while the pickers
 *   stop offering it.
 */
@Injectable()
export class AssetRolesAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * Lists the fleet-wide role vocabulary, retired codes included.
   *
   * **Not a duplicate of `GET /api/v1/vocabularies`, and the difference is the
   * reason this route exists.** That endpoint serves `active = true` only,
   * because a picker must not offer a retired code. An administrator who
   * retires a role through this module would then have no way to see it again,
   * and retirement through the API would be one-way. `PointKeysAdminController`
   * has the same shape for the same reason.
   *
   * Gated at `requireMasterDataUser`, not at `isGlobalAdmin`: reading which
   * codes exist reveals nothing about any tenant's estate, and the same reader
   * already gets the active ones from the unrestricted vocabularies endpoint.
   */
  async list(jwt: JwtPayload, activeOnly?: boolean): Promise<{ items: AssetRoleDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);

    const conditions = [];
    if (activeOnly === true) {
      conditions.push(eq(assetRoles.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(assetRoles.active, false));
    }

    const rows = await this.fleetDb
      .select()
      .from(assetRoles)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(assetRoles.sortOrder), asc(assetRoles.code));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Adds a code to the fleet-wide role vocabulary. */
  async create(jwt: JwtPayload, body: CreateAssetRoleBody): Promise<AssetRoleDto> {
    await this.requireGlobalAdmin(jwt);

    await this.fleetDb.transaction(async (tx) => {
      try {
        await tx.insert(assetRoles).values({
          code: body.code,
          label: body.label,
          ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
          active: true,
        });
      } catch (err) {
        // `code` is the primary key, so a repeat is the ordinary caller error
        // here rather than a fault. Without this it surfaces as a 500 and the
        // client cannot tell "already exists" from "the database is down".
        if (isUniqueViolation(err)) {
          throw new ConflictException(`Asset role "${body.code}" already exists`);
        }
        throw err;
      }

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_role.create",
          entityType: "asset_role",
          // `bms.audit_log.entity_id` is `uuid` and `asset_roles.code` is
          // `varchar(64)`. The code travels in the payload; see the
          // `entityId` note on `MasterDataAuditService`.
          entityId: null,
          organizationId: null,
          payload: body,
        },
        tx,
      );
    });

    return this.fetchRow(body.code);
  }

  /**
   * Edits a code's label, ordering or `active` flag.
   *
   * Retirement and restoration are both this method — `{ active: false }` and
   * `{ active: true }` — rather than the pair of `:id/deactivate` and
   * `:id/reactivate` routes `PointKeysAdminController` carries. ADR 0051
   * decision 5 names `POST` and `PATCH` and no third verb, and `active` is one
   * boolean column: two extra routes would be two more gates to keep in step
   * with this one.
   */
  async update(
    jwt: JwtPayload,
    code: string,
    body: UpdateAssetRoleBody,
  ): Promise<AssetRoleDto> {
    await this.requireGlobalAdmin(jwt);
    // The 404 check, and nothing more. The row it returns is deliberately NOT
    // used to build the `SET` — see below.
    await this.fetchRow(code);

    // `.partial()` accepts `{}`, which would write nothing and still leave an
    // audit row claiming an edit. A caller that sent an empty body meant
    // something, and a 400 says so. It also keeps `mapUpdateSet` from throwing
    // on a `SET` with no assignments, now that the `SET` is the body itself.
    if (Object.keys(body).length === 0) {
      throw new BadRequestException(
        "Send at least one of label, sortOrder or active",
      );
    }

    await this.fleetDb.transaction(async (tx) => {
      // `.set(body)` WRITES ONLY THE NAMED FIELDS. The first draft merged the
      // body over the row read above — `label ?? existing.label` and so on —
      // which is a read-modify-write across a transaction boundary and loses a
      // concurrent edit:
      //
      //   T0  admin B sends `{ label: "Pumps (all)" }`; the read returns
      //       `active: true`.
      //   T1  admin A sends `{ active: false }` and commits. `pump` is retired
      //       and leaves every picker.
      //   T2  B's transaction commits `active = true`, because that is what B
      //       read at T0.
      //
      // `pump` is live again, B never asked for it, and nothing raises. Writing
      // only what the caller named removes the window rather than narrowing it;
      // an unnamed column is not in the statement at all. Drizzle's
      // `mapUpdateSet` drops `undefined` keys, so an explicit `null` still
      // reaches the column and an absent key never does.
      await tx.update(assetRoles).set(body).where(eq(assetRoles.code, code));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.asset_role.update",
          entityType: "asset_role",
          entityId: null,
          organizationId: null,
          payload: { code, ...body },
        },
        tx,
      );
    });

    return this.fetchRow(code);
  }

  /**
   * The only write gate on a global vocabulary.
   *
   * `requireMasterDataUser` runs first and must not be skipped — it is what
   * turns a JWT into a `bms.users` row, and it refuses `operator` and `viewer`.
   * `isGlobalAdmin` then refuses every tenant administrator, `org_admin` and
   * `location_admin` alike. Copied in shape from
   * `PointKeysAdminService.requireGlobalAdmin`, which `F3.39` wrote for the
   * same class of table.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(
        "The asset role vocabulary is fleet-wide master data — only a global administrator may change it",
      );
    }
  }

  private async fetchRow(code: string): Promise<AssetRoleDto> {
    const [row] = await this.fleetDb
      .select()
      .from(assetRoles)
      .where(eq(assetRoles.code, code))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Asset role not found");
    }
    return this.mapRow(row);
  }

  private mapRow(item: typeof assetRoles.$inferSelect): AssetRoleDto {
    return {
      code: item.code,
      label: item.label,
      sortOrder: item.sortOrder,
      active: item.active,
    };
  }
}

/**
 * A `23505` from anywhere below drizzle.
 *
 * `pg` puts the SQLSTATE on `err.code`, and drizzle re-throws the driver error
 * unwrapped, so this reads the same field `packages/db` does. Written as a
 * narrowing helper rather than an `instanceof` because `pg`'s `DatabaseError`
 * is not exported from every entry point the API builds against.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}
