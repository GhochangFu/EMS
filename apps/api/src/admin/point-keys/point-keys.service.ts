import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import { pointKeys } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminPointKeyDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreatePointKeyBody, UpdatePointKeyBody } from "./point-keys.schema";

/**
 * `F3.39` / ADR 0051 decisions 2 and 3 — the point-key catalog is fleet-wide.
 *
 * **What changed, and why every part of it changed together.** `bms.point_keys`
 * carried `organization_id NOT NULL`, a `tenant_isolation` policy and FORCE
 * until migration `0057`. This service therefore read on `fleetDb` behind a
 * scope filter (`writableOrganizationIds` / `canManageOrganization`) and wrote
 * inside `withTenant(tenantDb, organizationId, …)`. None of that has a referent
 * any more:
 *
 * - **No tenant context on writes.** `withTenant` opens a transaction and sets
 *   `app.current_organization` for a policy that no longer exists, claiming a
 *   tenant the row does not have. Writes run on `fleetDb`, in a transaction so
 *   the audit row stays atomic with the mutation it describes.
 * - **The audit row is org-less.** A global-vocabulary edit is a fleet event,
 *   not a tenant one — `organizationId: null` with `fleetDb` as the executor,
 *   which is exactly the case ADR 0043 Amendment 5 carved out (`NULL` is
 *   admitted `TO bms_fleet` and refused `TO bms_tenant`).
 * - **No scope filter on reads.** Every organization now sees every code. A
 *   code is a measurement name: it names no asset, no site and no value, so it
 *   discloses nothing about another tenant's estate. `bms.asset_points` and
 *   `telemetry.point_values`, which do, keep their policies untouched.
 *
 * **THE WRITE PATH NARROWS AS THE READ PATH WIDENS, AND THAT IS THE POINT.**
 * `canManagePointKey` answered "may this caller manage THIS organization's
 * catalog" — a question with no referent once the catalog is fleet-wide.
 * Deleting the check without replacing it would silently hand every
 * `org_admin` write access to fleet-wide master data. So the four mutations
 * gate on the global `admin` role instead: ADR 0046's reasoning for audit
 * reads, applied to a write, and the same ruling `F3.40` makes for
 * `bms.asset_roles`. `tests/f3.39-global-point-key-vocabulary.test.ts` holds it.
 */
@Injectable()
export class PointKeysAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists the fleet-wide point key catalog. */
  async list(jwt: JwtPayload, activeOnly?: boolean): Promise<{ items: AdminPointKeyDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);

    const conditions = [];
    if (activeOnly === true) {
      conditions.push(eq(pointKeys.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(pointKeys.active, false));
    }

    const rows = await this.fleetDb
      .select()
      .from(pointKeys)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(pointKeys.code));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one point key. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    return this.fetchRow(id);
  }

  /** Creates a point key in the fleet-wide catalog. */
  async create(jwt: JwtPayload, body: CreatePointKeyBody): Promise<AdminPointKeyDto> {
    await this.requireGlobalAdmin(jwt);

    const created = await this.fleetDb.transaction(async (tx) => {
      const [row] = await tx
        .insert(pointKeys)
        .values({
          code: body.code,
          name: body.name,
          domain: body.domain ?? null,
          unit: body.unit ?? null,
          description: body.description ?? null,
          active: true,
        })
        .returning();

      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key.create",
          entityType: "point_key",
          entityId: row!.id,
          organizationId: null,
          payload: body,
        },
        tx,
      );
      return row!;
    });

    return this.fetchRow(created.id);
  }

  /** Updates a point key. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdatePointKeyBody,
  ): Promise<AdminPointKeyDto> {
    await this.requireGlobalAdmin(jwt);
    // The 404 check. Its row is deliberately not used to build the `SET`.
    await this.fetchRow(id);

    await this.fleetDb.transaction(async (tx) => {
      // `F3.40`'s review found this shape here as well as in
      // `AssetRolesAdminService`, and AGENTS.md §4.5 asks for the class rather
      // than the instance. Merging the body over a row read OUTSIDE the
      // transaction is a read-modify-write that loses a concurrent edit: an
      // administrator patching only `description` re-writes `name`, `domain`
      // and `unit` to whatever they read a moment earlier, silently undoing
      // another administrator's committed change. Writing only the named
      // fields removes the window instead of narrowing it.
      //
      // `mapUpdateSet` drops `undefined` keys and keeps `null` ones, so the
      // three nullable columns still clear when a caller sends an explicit
      // `null` — which is what the `!== undefined` ladder above existed for.
      //
      // THE EMPTY-BODY CONTRACT IS UNCHANGED, deliberately. `mapUpdateSet`
      // throws on a `SET` with no assignments, so the write is skipped rather
      // than attempted; `PATCH` with `{}` stays a 200 that changes nothing and
      // still writes its audit row, exactly as before. `AssetRolesAdminService`
      // answers 400 there because it is a new route and could choose; changing
      // this shipped one is a decision for its own row.
      if (Object.keys(body).length > 0) {
        await tx.update(pointKeys).set(body).where(eq(pointKeys.id, id));
      }

      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key.update",
          entityType: "point_key",
          entityId: id,
          organizationId: null,
          payload: body,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Deactivates a point key when no active asset mappings remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    await this.requireGlobalAdmin(jwt);
    await this.fetchRow(id);

    await this.fleetDb.transaction(async (tx) => {
      await tx.update(pointKeys).set({ active: false }).where(eq(pointKeys.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key.deactivate",
          entityType: "point_key",
          entityId: id,
          organizationId: null,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /** Reactivates a point key. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminPointKeyDto> {
    await this.requireGlobalAdmin(jwt);
    await this.fetchRow(id);

    await this.fleetDb.transaction(async (tx) => {
      await tx.update(pointKeys).set({ active: true }).where(eq(pointKeys.id, id));
      await this.audit.write(
        {
          actor: jwt,
          action: "master.point_key.reactivate",
          entityType: "point_key",
          entityId: id,
          organizationId: null,
        },
        tx,
      );
    });
    return this.fetchRow(id);
  }

  /**
   * The only write gate on a global vocabulary.
   *
   * `requireMasterDataUser` still runs first, and it still refuses `operator`
   * and `viewer` — it is what turns a JWT into a database user row and it must
   * not be skipped. `isGlobalAdmin` then refuses every tenant administrator,
   * `location_admin` and `org_admin` alike. The old code named
   * `location_admin` explicitly and let `org_admin` through, which was correct
   * while the catalog was per-organization and is a hole now that it is not.
   */
  private async requireGlobalAdmin(jwt: JwtPayload): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isGlobalAdmin(jwt))) {
      throw new ForbiddenException(
        "The point key catalog is fleet-wide master data — only a global administrator may change it",
      );
    }
  }

  private async fetchRow(id: string): Promise<AdminPointKeyDto> {
    const [row] = await this.fleetDb
      .select()
      .from(pointKeys)
      .where(eq(pointKeys.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Point key not found");
    }
    return this.mapRow(row);
  }

  private mapRow(item: typeof pointKeys.$inferSelect): AdminPointKeyDto {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      domain: item.domain,
      unit: item.unit,
      description: item.description,
      active: item.active,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
