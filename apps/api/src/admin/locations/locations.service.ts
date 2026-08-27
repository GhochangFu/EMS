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
import type { AdminLocationDto, AdminLocationSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { CreateLocationBody, UpdateLocationBody } from "./locations.schema";

/**
 * `F4.16` / ADR 0043 — `locations` is one of the five tables `F4.16` routes on
 * `fleetDb` (migration `0040`); Amendment 3 decision 2 grandfathers that
 * behaviour and asks only for the reason this comment now records. Reads run on
 * `fleetDb` because `writableLocationIds`/`canManageLocation` resolve to a
 * cross-organization union for a multi-org master-data admin — a single tenant
 * GUC cannot serve them, and decision 3 routes that case to the fleet pool
 * rather than looping one transaction per organization. The `WHERE` filter is
 * the isolation control the amendment trusts. Writes run inside
 * `withTenant(tenantDb, organizationId, …)`, which sets the RLS GUC to the
 * row's own organization before insert/update — the id is always known
 * before the write (from the request body, or from a fleet read already
 * authorized by `canManageLocation`).
 */
@Injectable()
export class LocationsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists locations scoped to the caller. */
  async list(
    jwt: JwtPayload,
    organizationId?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AdminLocationDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableIds = await this.accessControl.writableLocationIds(jwt);
    const conditions = [];
    if (organizationId) {
      conditions.push(eq(locations.organizationId, organizationId));
    }
    if (writableIds !== null) {
      if (writableIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(locations.id, writableIds));
    }
    if (activeOnly === true) {
      conditions.push(eq(locations.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(locations.active, false));
    }

    const rows = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(locations.name));

    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Returns one location summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminLocationSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const [row] = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(locations.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return {
      id: row.location.id,
      code: row.location.code,
      name: row.location.name,
      organizationId: row.location.organizationId,
      organizationCode: row.organizationCode,
      organizationName: row.organizationName,
    };
  }

  /** Creates a location within the caller's writable scope. */
  async create(jwt: JwtPayload, body: CreateLocationBody): Promise<AdminLocationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (user.role === "location_admin") {
      throw new ForbiddenException("Location admins cannot create new locations");
    }
    if (!(await this.accessControl.canManageOrganization(jwt, body.organizationId))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }

    const created = await withTenant(this.tenantDb, body.organizationId, (tx) =>
      tx
        .insert(locations)
        .values({
          organizationId: body.organizationId,
          code: body.code,
          slug: body.slug,
          name: body.name,
          type: body.type,
          province: body.province ?? null,
          capital: body.capital ?? null,
          latitude: body.latitude,
          longitude: body.longitude,
          meta: body.meta ?? null,
          active: true,
        })
        .returning()
        .then(([row]) => row),
    );

    const row = await this.fetchRow(created.id);
    await this.audit.write({
      actor: jwt,
      action: "master.location.create",
      entityType: "location",
      entityId: created.id,
      payload: body,
    });
    return row;
  }

  /** Updates a location in scope. */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateLocationBody,
  ): Promise<AdminLocationDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [existing] = await this.fleetDb
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }

    await withTenant(this.tenantDb, existing.organizationId, (tx) =>
      tx
        .update(locations)
        .set({
          code: body.code ?? existing.code,
          slug: body.slug ?? existing.slug,
          name: body.name ?? existing.name,
          type: body.type ?? existing.type,
          province: body.province !== undefined ? body.province : existing.province,
          capital: body.capital !== undefined ? body.capital : existing.capital,
          latitude: body.latitude ?? existing.latitude,
          longitude: body.longitude ?? existing.longitude,
          meta: body.meta !== undefined ? body.meta : existing.meta,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, id)),
    );

    await this.audit.write({
      actor: jwt,
      action: "master.location.update",
      entityType: "location",
      entityId: id,
      payload: body,
    });
    return this.fetchRow(id);
  }

  /** Deactivates a location when no active RTUs or assets remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminLocationDto> {
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [existing] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }

    // E7.1b: `rtus` and `assets` are FORCE-policied as of 0047, so these guard
    // counts must run inside the location's org GUC — on the bare tenant pool
    // with no `SET LOCAL` they return 0 and the guard never fires, deactivating a
    // location that still has active RTUs or assets. `rtus.service.deactivate`
    // counts inside its own GUC for the same reason; this matches it.
    const { activeRtu, activeAsset } = await withTenant(
      this.tenantDb,
      existing.organizationId,
      async (tx) => {
        const [activeRtu] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(rtus)
          .where(and(eq(rtus.locationId, id), eq(rtus.active, true)))
          .limit(1);
        const [activeAsset] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(assets)
          .where(and(eq(assets.locationId, id), eq(assets.active, true)))
          .limit(1);
        return { activeRtu, activeAsset };
      },
    );
    if ((activeRtu?.count ?? 0) > 0 || (activeAsset?.count ?? 0) > 0) {
      throw new ConflictException("Cannot deactivate location with active RTUs or assets");
    }

    await withTenant(this.tenantDb, existing.organizationId, (tx) =>
      tx
        .update(locations)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(locations.id, id)),
    );

    await this.audit.write({
      actor: jwt,
      action: "master.location.deactivate",
      entityType: "location",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  /** Reactivates a location. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminLocationDto> {
    if (!(await this.accessControl.canManageLocation(jwt, id))) {
      throw new ForbiddenException("Location is outside your access scope");
    }

    const [existing] = await this.fleetDb
      .select({ organizationId: locations.organizationId })
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Location not found");
    }

    await withTenant(this.tenantDb, existing.organizationId, (tx) =>
      tx
        .update(locations)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(locations.id, id)),
    );

    await this.audit.write({
      actor: jwt,
      action: "master.location.reactivate",
      entityType: "location",
      entityId: id,
    });
    return this.fetchRow(id);
  }

  private async fetchRow(id: string): Promise<AdminLocationDto> {
    const [row] = await this.fleetDb
      .select({
        location: locations,
        organizationCode: organizations.code,
        organizationName: organizations.name,
      })
      .from(locations)
      .innerJoin(organizations, eq(locations.organizationId, organizations.id))
      .where(eq(locations.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Location not found");
    }
    return this.mapRow(row);
  }

  private mapRow(row: {
    location: typeof locations.$inferSelect;
    organizationCode: string;
    organizationName: string;
  }): AdminLocationDto {
    const loc = row.location;
    return {
      id: loc.id,
      organizationId: loc.organizationId,
      organizationCode: row.organizationCode,
      organizationName: row.organizationName,
      code: loc.code,
      slug: loc.slug,
      name: loc.name,
      type: loc.type as AdminLocationDto["type"],
      province: loc.province,
      capital: loc.capital,
      latitude: loc.latitude,
      longitude: loc.longitude,
      active: loc.active,
      meta: (loc.meta as Record<string, unknown> | null) ?? null,
      createdAt: loc.createdAt.toISOString(),
      updatedAt: loc.updatedAt.toISOString(),
    };
  }
}
