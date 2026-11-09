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
import { colourProfileSchema, designSystemSchema } from "@bms/shared";
import type {
  AdminOrganizationDto,
  AdminOrganizationSummaryDto,
  ColourProfile,
  DesignSystem,
  JwtPayload,
  SetOrganizationAppearanceBody,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { translateConstraintErrors } from "../../database/translate-constraint-errors";
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
    return { id: row.id, code: row.code, name: row.name, ingestEnabled: row.ingestEnabled };
  }

  /** Creates an organization (global admin only). */
  async create(jwt: JwtPayload, body: CreateOrganizationBody): Promise<AdminOrganizationDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    this.accessControl.assertAdminRole(user.role);

    // F4.211 — a taken code is a 409 that names it, not pg's 23505 as a 500.
    const [created] = await translateConstraintErrors(
      () =>
        this.tenantDb
          .insert(organizations)
          .values({
            code: body.code,
            name: body.name,
            currency: body.currency,
            // F3.85: absent → the column default ('UTC').
            ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
            meta: body.meta ?? null,
            active: true,
          })
          .returning(),
      {
        onUnique: () =>
          new ConflictException(`An organization with code "${body.code}" already exists`),
      },
    );

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
        currency: body.currency ?? existing.currency,
        timezone: body.timezone ?? existing.timezone,
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

  /**
   * `F4.341` (ADR 0118 decision 10) — sets the organization's design system and colour profile;
   * `null` clears a value, so the organization inherits the portal default. The `F4.310` gate (ADR
   * 0110 decision 7, plan OQ4): the global `admin` may set any organization; an
   * `organization_admin` only one they hold a **direct** organization grant on
   * (`isOrganizationLevelAdmin`, the gate a location move uses). Every other role, and an
   * `organization_admin` without that grant, is a 403 before any read.
   *
   * This is the organization's own setting, so the write and its audit row run in one `withTenant`
   * transaction and the audit row carries the organization id (the `locations.service.ts` shape):
   * its own admins see it in their audit view. The row carries the old and the new values.
   */
  async setAppearance(jwt: JwtPayload, id: string, body: SetOrganizationAppearanceBody): Promise<AdminOrganizationDto> {
    return this.writeAppearance(jwt, id, body, "master.organization.appearance.update");
  }

  /**
   * `F4.310` (ADR 0110 decision 7) — `PUT …/colour-profile`, kept as an alias of
   * {@link setAppearance} until `F4.342` removes it (ADR 0118 Amendment 2 P5). It writes the
   * profile only (the design system is left as it is) and keeps its own audit action, so an audit
   * reader of the old route sees no change.
   */
  async setColourProfile(jwt: JwtPayload, id: string, colourProfile: ColourProfile): Promise<AdminOrganizationDto> {
    return this.writeAppearance(jwt, id, { colourProfile }, "master.organization.colour_profile.update");
  }

  private async writeAppearance(
    jwt: JwtPayload,
    id: string,
    patch: { designSystem?: DesignSystem | null; colourProfile?: ColourProfile | null },
    action: "master.organization.appearance.update" | "master.organization.colour_profile.update",
  ): Promise<AdminOrganizationDto> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.isOrganizationLevelAdmin(jwt, id))) {
      throw new ForbiddenException("Only an administrator of this organization can change its appearance");
    }

    return withTenant(this.tenantDb, id, async (tx) => {
      const [existing] = await tx
        .select({ designSystem: organizations.designSystem, colourProfile: organizations.colourProfile })
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);
      if (!existing) {
        throw new NotFoundException("Organization not found");
      }

      const [updated] = await tx.update(organizations).set(patch).where(eq(organizations.id, id)).returning();

      const payload =
        action === "master.organization.colour_profile.update"
          ? { from: existing.colourProfile, to: patch.colourProfile ?? null }
          : {
              from: { designSystem: existing.designSystem, colourProfile: existing.colourProfile },
              to: { designSystem: updated.designSystem, colourProfile: updated.colourProfile },
            };
      await this.audit.write(
        { actor: jwt, action, entityType: "organization", entityId: id, organizationId: id, payload },
        tx,
      );

      return this.mapRow(updated);
    });
  }

  /**
   * `F4.330` (ADR 0115 decision 3) — switches an organization's ingestion on or off (global admin
   * only, `assertAdminRole`: an `organization_admin` is a 403, so a tenant cannot stop or resume its
   * own data). The ingest host applies the value at its next reload; each RTU's own
   * `ingest_enabled` is kept as it is (decision 4), and `active` is not coupled (decision 10).
   *
   * The `deactivate` shape: read and write on `tenantDb` (`organizations` carries no policy), one
   * platform audit row (`organizationId: null`, on `fleetDb`) with no payload — the action names
   * the direction. A value equal to the stored one returns the row and writes nothing: no
   * `UPDATE`, no audit row (plan R2).
   */
  async setIngestEnabled(jwt: JwtPayload, id: string, ingestEnabled: boolean): Promise<AdminOrganizationDto> {
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
    if (existing.ingestEnabled === ingestEnabled) {
      return this.mapRow(existing);
    }

    const [updated] = await this.tenantDb
      .update(organizations)
      .set({ ingestEnabled })
      .where(eq(organizations.id, id))
      .returning();

    await this.audit.write(
      {
        actor: jwt,
        action: ingestEnabled ? "master.organization.ingest.enable" : "master.organization.ingest.disable",
        entityType: "organization",
        entityId: id,
        organizationId: null,
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
      currency: row.currency,
      timezone: row.timezone,
      // F4.341: NULL (inherit the portal) stays null; an out-of-list value (a CHECK forbids it) reads
      // as null too, never as a 500 on the list (the F4.108 rule).
      colourProfile: colourProfileSchema.safeParse(row.colourProfile).data ?? null,
      designSystem: designSystemSchema.safeParse(row.designSystem).data ?? null,
      ingestEnabled: row.ingestEnabled,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
