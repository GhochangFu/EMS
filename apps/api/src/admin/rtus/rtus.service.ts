import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { assets, locations, organizations, rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminRtuDto, AdminRtuSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateRtuBody, UpdateRtuBody } from "./rtus.schema";

/**
 * `F4.16` / `E7.1b` / ADR 0043 — `rtus` gains `organization_id` + a
 * `tenant_isolation` policy + `FORCE` in migration `0047`.
 *
 * Reads run on `fleetDb`, trusting the `writableLocationIds`/`canManageLocation`
 * scope filter this service already applies (Amendment 2/3) — the same "bypass,
 * then trust an already-computed grant" shape `AccessControlService` uses. Writes
 * run inside `withTenant(tenantDb, organizationId, …)`; the org is the RTU's
 * location's org, resolved before the write. An RTU never relocates (its
 * `location_id` is not updatable), so — unlike `assets` — there is no cross-org
 * move to guard against. The `deactivate` active-asset count reads `assets`
 * (policied in `0047`) inside that same GUC.
 */
@Injectable()
export class RtusAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists RTUs scoped to writable locations. */
  async list(
    jwt: JwtPayload,
    locationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminRtuDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (locationId) {
      if (!(await this.accessControl.canManageLocation(jwt, locationId))) {
        throw new ForbiddenException("Location is outside your access scope");
      }
      conditions.push(eq(rtus.locationId, locationId));
    } else if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(rtus.locationId, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(rtus.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(rtus.active, false));
    }

    const rows = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(rtus.displayName));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one RTU summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminRtuSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    const [row] = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationId: organizations.id,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, row.rtu.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }
    return {
      id: row.rtu.id,
      code: row.rtu.code,
      displayName: row.rtu.displayName,
      locationId: row.rtu.locationId,
      locationName: row.locationName,
      organizationId: row.organizationId,
      organizationCode: row.organizationCode,
    };
  }

  /** Creates an RTU under a writable location. */
  async create(jwt: JwtPayload, body: CreateRtuBody): Promise<AdminRtuDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, body.locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const organizationId = await this.resolveLocationOrg(body.locationId);

    const created = await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .insert(rtus)
        .values({
          locationId: body.locationId,
          code: body.code,
          displayName: body.displayName,
          sourceType: body.sourceType,
          domain: body.domain ?? null,
          externalRtuId: body.externalRtuId ?? null,
          rtuCode: body.rtuCode ?? null,
          mqttTopic: body.mqttTopic ?? null,
          stationCode: body.stationCode ?? null,
          stationName: body.stationName ?? null,
          ingestEnabled: body.ingestEnabled ?? false,
          organizationId,
          meta: body.meta ?? null,
          active: true,
        })
        .returning()
        .then(([row]) => row),
    );

    await this.audit.write({
      actor: jwt,
      action: "master.rtu.create",
      entityType: "rtu",
      entityId: created.id,
      payload: body,
    });
    return this.fetchRow(created.id);
  }

  /** Updates an RTU in scope. */
  async update(jwt: JwtPayload, id: string, body: UpdateRtuBody): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    await withTenant(this.tenantDb, organizationId, (tx) =>
      tx
        .update(rtus)
        .set({
        code: body.code ?? existing.code,
        displayName: body.displayName ?? existing.displayName,
        sourceType: body.sourceType ?? existing.sourceType,
        domain: body.domain !== undefined ? body.domain : existing.domain,
        externalRtuId:
          body.externalRtuId !== undefined ? body.externalRtuId : existing.externalRtuId,
        rtuCode: body.rtuCode !== undefined ? body.rtuCode : existing.rtuCode,
        mqttTopic: body.mqttTopic !== undefined ? body.mqttTopic : existing.mqttTopic,
        stationCode:
          body.stationCode !== undefined ? body.stationCode : existing.stationCode,
        stationName:
          body.stationName !== undefined ? body.stationName : existing.stationName,
        ingestEnabled: body.ingestEnabled ?? existing.ingestEnabled,
        // Merged, not replaced. A PATCH carrying `meta` used to swap the whole
        // object, and `bms.rtus.meta` is a shared bag holding keys this caller
        // knows nothing about. One of them is load-bearing: `F1.7` stamps
        // `enabledSetVersion` there, and the seed reads it to decide whether
        // `ingest_enabled` still belongs to the operator. Dropping the key on an
        // unrelated `meta` write therefore handed the column back to the seed,
        // which then reverted the operator's own switch on the next
        // `pnpm db:seed` — the exact defect `F1.7` closed, re-entering through
        // the API that owns the column. Unreachable from the current admin
        // screen, which never sends `meta`; that is a coupling across two
        // packages with nothing enforcing it, not a design.
        meta:
          body.meta !== undefined
            ? { ...(existing.meta ?? {}), ...body.meta }
            : existing.meta,
        organizationId,
      })
        .where(eq(rtus.id, id)),
    );

    await this.audit.write({
      actor: jwt,
      action: "master.rtu.update",
      entityType: "rtu",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates an RTU when no active assets remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      // The RTU's assets share its org, so the active-asset guard reads `assets`
      // (policied in 0047) inside the same tenant GUC.
      const [activeAsset] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(assets)
        .where(and(eq(assets.rtuId, id), eq(assets.active, true)))
        .limit(1);
      if ((activeAsset?.count ?? 0) > 0) {
        throw new ConflictException("Cannot deactivate RTU with active assets");
      }
      await tx.update(rtus).set({ active: false }).where(eq(rtus.id, id));
    });
    await this.audit.write({
      actor: jwt,
      action: "master.rtu.deactivate",
      entityType: "rtu",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates an RTU. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminRtuDto> {
    // fleetDb read (Amendment 2/3): `rtus` gains a policy in 0047; the
    // `canManageLocation` gate below is the isolation control.
    const [existing] = await this.fleetDb
      .select()
      .from(rtus)
      .where(eq(rtus.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("RTU not found");
    }
    if (!(await this.accessControl.canManageLocation(jwt, existing.locationId))) {
      throw new ForbiddenException("RTU is outside your access scope");
    }

    const organizationId =
      existing.organizationId ?? (await this.resolveLocationOrg(existing.locationId));
    await withTenant(this.tenantDb, organizationId, (tx) =>
      tx.update(rtus).set({ active: true }).where(eq(rtus.id, id)),
    );
    await this.audit.write({
      actor: jwt,
      action: "master.rtu.reactivate",
      entityType: "rtu",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /**
   * Resolves a location's organization on `fleetDb` before a write opens its
   * tenant context. `locations` carries a policy (`0040`); the caller has
   * already passed `canManageLocation` for this location, which is the
   * isolation control.
   */
  private async resolveLocationOrg(locationId: string): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return row.organizationId;
  }

  private async fetchRow(id: string): Promise<AdminRtuDto> {
    const [row] = await this.fleetDb
      .select({
        rtu: rtus,
        locationName: locations.name,
        organizationCode: organizations.code,
      })
      .from(rtus)
      .innerJoin(locations, eq(rtus.locationId, locations.id))
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(rtus.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("RTU not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    rtu: typeof rtus.$inferSelect;
    locationName: string;
    organizationCode: string;
  }): AdminRtuDto {
    const rtu = row.rtu;
    return {
      id: rtu.id,
      locationId: rtu.locationId,
      locationName: row.locationName,
      organizationCode: row.organizationCode,
      code: rtu.code,
      displayName: rtu.displayName,
      sourceType: rtu.sourceType as AdminRtuDto["sourceType"],
      domain: rtu.domain,
      externalRtuId: rtu.externalRtuId,
      rtuCode: rtu.rtuCode,
      mqttTopic: rtu.mqttTopic,
      stationCode: rtu.stationCode,
      stationName: rtu.stationName,
      ingestEnabled: rtu.ingestEnabled,
      active: rtu.active,
      meta: (rtu.meta as Record<string, unknown> | null) ?? null,
      createdAt: rtu.createdAt.toISOString(),
    };
  }
}
