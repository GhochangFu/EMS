import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { locations, organizations } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminOrganizationDto, AdminOrganizationSummaryDto, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { MasterDataAuditService } from "../master-data-audit.service";
import type {
  CreateOrganizationBody,
  UpdateOrganizationBody,
} from "./organizations.schema";

/**
 * `F4.16` / ADR 0043 — `organizations` itself carries no policy, so every
 * read/write against it stays on `tenantDb`. `deactivate`'s active-locations
 * check queries `locations` (RLS since migration `0040`) and runs on
 * `fleetDb` instead — a global admin's own gate (`assertAdminRole`) already
 * ran before this method does anything, so there is no scope to preserve.
 *
 * `E7.1c` (item D) — every `audit.write` here is a platform event, not a
 * tenant one: `bms.audit_log.organizationId`'s own schema comment names
 * `"organization X created"` as the canonical example of a `NULL`-org row.
 * Every method here is `assertAdminRole`-gated (global admin only) and acts
 * on an organization's own lifecycle, not on a resource a tenant owns, so
 * each `audit.write` passes `organizationId: null` and `this.fleetDb`
 * explicitly as `executor` — the default tenant pool admits neither `null`
 * nor a real id once `0048` lands.
 */
@Injectable()
export class OrganizationsAdminService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** Lists organizations visible to the caller. */
  async list(
    jwt: JwtPayload,
    activeOnly?: boolean,
  ): Promise<{ items: AdminOrganizationDto[] }> {
    await this.accessControl.requireMasterDataUser(jwt);
    const writableOrgIds = await this.accessControl.writableOrganizationIds(jwt);
    const conditions = [];
    if (activeOnly === true) {
      conditions.push(eq(organizations.active, true));
    } else if (activeOnly === false) {
      conditions.push(eq(organizations.active, false));
    }

    if (writableOrgIds !== null) {
      if (writableOrgIds.length === 0) {
        return { items: [] };
      }
      conditions.push(inArray(organizations.id, writableOrgIds));
    }

    const rows = await this.tenantDb
      .select()
      .from(organizations)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(organizations.code));

    return {
      items: rows.map((row) => this.mapRow(row)),
    };
  }

  /** Returns one organization summary when in scope. */
  async getById(jwt: JwtPayload, id: string): Promise<AdminOrganizationSummaryDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageOrganization(jwt, id))) {
      throw new ForbiddenException("Organization is outside your access scope");
    }
    const [row] = await this.tenantDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Organization not found");
    }
    return { id: row.id, code: row.code, name: row.name };
  }

  /** Creates an organization (global admin only). */
  async create(jwt: JwtPayload, body: CreateOrganizationBody): Promise<AdminOrganizationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    const [created] = await this.tenantDb
      .insert(organizations)
      .values({
        code: body.code,
        name: body.name,
        meta: body.meta ?? null,
        active: true,
      })
      .returning();

    await this.audit.write(
      {
        actor: jwt,
        action: "master.organization.create",
        entityType: "organization",
        entityId: created.id,
        organizationId: null,
        payload: body,
      },
      this.fleetDb,
    );

    return this.mapRow(created);
  }

  /** Updates an organization (global admin only). */
  async update(
    jwt: JwtPayload,
    id: string,
    body: UpdateOrganizationBody,
  ): Promise<AdminOrganizationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    const [existing] = await this.tenantDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Organization not found");
    }

    const [updated] = await this.tenantDb
      .update(organizations)
      .set({
        name: body.name ?? existing.name,
        meta: body.meta !== undefined ? body.meta : existing.meta,
      })
      .where(eq(organizations.id, id))
      .returning();

    await this.audit.write(
      {
        actor: jwt,
        action: "master.organization.update",
        entityType: "organization",
        entityId: id,
        organizationId: null,
        payload: body,
      },
      this.fleetDb,
    );

    return this.mapRow(updated);
  }

  /** Deactivates an organization when no active locations remain. */
  async deactivate(jwt: JwtPayload, id: string): Promise<AdminOrganizationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    const [existing] = await this.tenantDb
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    if (!existing) {
      throw new NotFoundException("Organization not found");
    }

    const [activeChild] = await this.fleetDb
      .select({ count: sql<number>`count(*)::int` })
      .from(locations)
      .where(and(eq(locations.organizationId, id), eq(locations.active, true)))
      .limit(1);
    if ((activeChild?.count ?? 0) > 0) {
      throw new ConflictException("Cannot deactivate organization with active locations");
    }

    const [updated] = await this.tenantDb
      .update(organizations)
      .set({ active: false })
      .where(eq(organizations.id, id))
      .returning();

    await this.audit.write(
      {
        actor: jwt,
        action: "master.organization.deactivate",
        entityType: "organization",
        entityId: id,
        organizationId: null,
      },
      this.fleetDb,
    );

    return this.mapRow(updated);
  }

  /** Reactivates an organization. */
  async reactivate(jwt: JwtPayload, id: string): Promise<AdminOrganizationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    const [updated] = await this.tenantDb
      .update(organizations)
      .set({ active: true })
      .where(eq(organizations.id, id))
      .returning();
    if (!updated) {
      throw new NotFoundException("Organization not found");
    }

    await this.audit.write(
      {
        actor: jwt,
        action: "master.organization.reactivate",
        entityType: "organization",
        entityId: id,
        organizationId: null,
      },
      this.fleetDb,
    );

    return this.mapRow(updated);
  }

  private mapRow(row: typeof organizations.$inferSelect): AdminOrganizationDto {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      active: row.active,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
