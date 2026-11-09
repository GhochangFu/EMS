import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import {
  adminOrganizationDtoSchema,
  currentUserResponseSchema,
  portalAppearanceDtoSchema,
  publicAppearanceDtoSchema,
} from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../../auth/access-control.service";
import type { OrganizationsAdminService } from "../organizations/organizations.service";
import type { PortalSettingsService } from "./portal-settings.service";

/**
 * `F4.341` / ADR 0118 decisions 8–12 — the three appearance writes, the public read and the
 * `/auth/me` precedence, against the real database.
 *
 * Assertions live here; `appearance.integration.test.ts` owns the pools and the cleanup (ADR
 * 0014). **Every claim that writes a shared row puts it back in a `finally`:** the portal row (one
 * for the whole database), the asset-group admin's own `bms.users` row and its home organization's
 * design system. Read-backs run as `bms_fleet`.
 */
export type AppearanceCtx = {
  portal: PortalSettingsService;
  orgs: OrganizationsAdminService;
  access: AccessControlService;
  fleetPool: pg.Pool;
  globalAdmin: JwtPayload;
  organizationAdmin: JwtPayload;
  locationAdmin: JwtPayload;
  /** The user whose own row the `/me` claims write (no other suite writes it). */
  member: JwtPayload;
  memberId: string;
  memberOrgId: string;
};

type Stored = { design_system: string | null; colour_profile: string | null };

async function portalRow(ctx: AppearanceCtx): Promise<{ design_system: string; colour_profile: string }> {
  const { rows } = await ctx.fleetPool.query("SELECT design_system, colour_profile FROM bms.portal_settings WHERE id = 1");
  return rows[0] as { design_system: string; colour_profile: string };
}

async function restorePortal(ctx: AppearanceCtx, row: { design_system: string; colour_profile: string }): Promise<void> {
  await ctx.fleetPool.query("UPDATE bms.portal_settings SET design_system = $1, colour_profile = $2 WHERE id = 1", [
    row.design_system,
    row.colour_profile,
  ]);
}

async function memberRow(ctx: AppearanceCtx): Promise<Stored> {
  const { rows } = await ctx.fleetPool.query<Stored>("SELECT design_system, colour_profile FROM bms.users WHERE id = $1", [
    ctx.memberId,
  ]);
  return rows[0] as Stored;
}

async function latestAudit(ctx: AppearanceCtx, action: string, entityId: string | null): Promise<{ payload: unknown; organization_id: string | null } | undefined> {
  const { rows } = await ctx.fleetPool.query(
    `SELECT payload, organization_id FROM bms.audit_log
      WHERE action = $1 AND entity_id IS NOT DISTINCT FROM $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [action, entityId],
  );
  return rows[0] as { payload: unknown; organization_id: string | null } | undefined;
}

/** A1 — the migration seeded exactly one portal row; the public read answers its two values and nothing else. */
export async function thePublicReadIsTwoKeys(ctx: AppearanceCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<{ n: string }>("SELECT count(*)::text AS n FROM bms.portal_settings");
  expect(rows[0]?.n).toBe("1");
  const body = await ctx.portal.readPublic();
  expect(Object.keys(body).sort()).toEqual(["colourProfile", "designSystem"]);
  expect(publicAppearanceDtoSchema.parse(body)).toEqual(body);
  const row = await portalRow(ctx);
  expect(body).toEqual({ designSystem: row.design_system, colourProfile: row.colour_profile });
}

/** A2 — the global admin reads and writes the portal default; one platform audit row with from/to. */
export async function theGlobalAdminSetsThePortal(ctx: AppearanceCtx): Promise<void> {
  const original = await portalRow(ctx);
  try {
    expect(portalAppearanceDtoSchema.safeParse(await ctx.portal.read(ctx.globalAdmin)).success).toBe(true);
    const target = original.design_system === "swiss-grid" ? "bento-ops" : "swiss-grid";
    const dto = await ctx.portal.write(ctx.globalAdmin, { designSystem: target, colourProfile: "forest" });
    expect(portalAppearanceDtoSchema.parse(dto)).toMatchObject({ designSystem: target, colourProfile: "forest" });
    expect(dto.updatedBy).toBe(ctx.globalAdmin.sub);
    expect(await ctx.portal.readPublic()).toEqual({ designSystem: target, colourProfile: "forest" });
    const audit = await latestAudit(ctx, "master.portal.appearance.update", null);
    expect(audit?.organization_id).toBeNull();
    expect(audit?.payload).toMatchObject({
      from: { designSystem: original.design_system, colourProfile: original.colour_profile },
      to: { designSystem: target, colourProfile: "forest" },
    });
  } finally {
    await restorePortal(ctx, original);
  }
}

/** A3 — every other role is a 403 on the portal read and write; the row is unchanged. */
export async function everyOtherRoleIs403OnThePortal(ctx: AppearanceCtx): Promise<void> {
  const before = await portalRow(ctx);
  for (const jwt of [ctx.organizationAdmin, ctx.locationAdmin]) {
    await expect(ctx.portal.read(jwt)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctx.portal.write(jwt, { designSystem: "bento-ops", colourProfile: "sand" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  }
  await expect(ctx.portal.read(ctx.member)).rejects.toBeInstanceOf(ForbiddenException);
  expect(await portalRow(ctx)).toEqual(before);
}

/** A4 — Postgres refuses a second portal row and an out-of-list value. */
export async function theTableHoldsOneValidRow(ctx: AppearanceCtx): Promise<void> {
  await expect(ctx.fleetPool.query("UPDATE bms.portal_settings SET design_system = 'glass-showcase' WHERE id = 1")).rejects.toThrow(
    /portal_settings_design_system_check/,
  );
  await expect(ctx.fleetPool.query("INSERT INTO bms.portal_settings (id) VALUES (2)")).rejects.toThrow(/permission denied|single_row/);
}

/**
 * A5 — the organization route: the global admin sets any organization's design system, `null`
 * clears it, and each write leaves an audit row with from/to; a location admin is a 403.
 */
export async function theOrganizationRouteSetsAndClears(ctx: AppearanceCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<Stored>("SELECT design_system, colour_profile FROM bms.organizations WHERE id = $1", [
    ctx.memberOrgId,
  ]);
  const original = rows[0] as Stored;
  try {
    const set = await ctx.orgs.setAppearance(ctx.globalAdmin, ctx.memberOrgId, {
      designSystem: "control-room-dark",
      colourProfile: original.colour_profile as never,
    });
    expect(adminOrganizationDtoSchema.parse(set).designSystem).toBe("control-room-dark");
    const audit = await latestAudit(ctx, "master.organization.appearance.update", ctx.memberOrgId);
    expect(audit?.organization_id).toBe(ctx.memberOrgId);
    expect(audit?.payload).toMatchObject({ from: { designSystem: original.design_system }, to: { designSystem: "control-room-dark" } });

    const cleared = await ctx.orgs.setAppearance(ctx.globalAdmin, ctx.memberOrgId, { designSystem: null, colourProfile: null });
    expect(cleared.designSystem).toBeNull();
    expect(cleared.colourProfile).toBeNull();

    await expect(
      ctx.orgs.setAppearance(ctx.locationAdmin, ctx.memberOrgId, { designSystem: "bento-ops", colourProfile: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  } finally {
    await ctx.fleetPool.query("UPDATE bms.organizations SET design_system = $2, colour_profile = $3 WHERE id = $1", [
      ctx.memberOrgId,
      original.design_system,
      original.colour_profile,
    ]);
  }
}

/** A6 — the old colour-profile route still answers (the alias, until `F4.342`). */
export async function theOldRouteIsAnAlias(ctx: AppearanceCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<Stored>("SELECT design_system, colour_profile FROM bms.organizations WHERE id = $1", [
    ctx.memberOrgId,
  ]);
  const original = rows[0] as Stored;
  try {
    const dto = await ctx.orgs.setColourProfile(ctx.globalAdmin, ctx.memberOrgId, "sand");
    expect(dto.colourProfile).toBe("sand");
    expect(dto.designSystem).toBe(original.design_system);
  } finally {
    await ctx.fleetPool.query("UPDATE bms.organizations SET colour_profile = $2 WHERE id = $1", [ctx.memberOrgId, original.colour_profile]);
  }
}

/**
 * A7 — `PUT /me/appearance` writes the caller's own row only, `null` clears it, and the audit row
 * carries from/to; then `/auth/me` resolves user > organization > portal with the level of each.
 */
export async function aUserSetsTheirOwnAndMeResolves(ctx: AppearanceCtx): Promise<void> {
  const ownBefore = await memberRow(ctx);
  const portalBefore = await portalRow(ctx);
  const { rows } = await ctx.fleetPool.query<Stored>("SELECT design_system, colour_profile FROM bms.organizations WHERE id = $1", [
    ctx.memberOrgId,
  ]);
  const orgBefore = rows[0] as Stored;
  try {
    await restorePortal(ctx, { design_system: "swiss-grid", colour_profile: "ocean" });
    await ctx.fleetPool.query("UPDATE bms.organizations SET design_system = 'bento-ops', colour_profile = NULL WHERE id = $1", [
      ctx.memberOrgId,
    ]);

    expect(await ctx.portal.writeMine(ctx.member, { designSystem: null, colourProfile: "navy-pop" })).toEqual({
      designSystem: null,
      colourProfile: "navy-pop",
    });
    expect(await memberRow(ctx)).toEqual({ design_system: null, colour_profile: "navy-pop" });
    const audit = await latestAudit(ctx, "user.appearance.update", ctx.memberId);
    expect(audit?.payload).toMatchObject({ to: { designSystem: null, colourProfile: "navy-pop" } });

    const me = currentUserResponseSchema.parse(await ctx.access.currentUser(ctx.member));
    expect(me.appearance).toEqual({
      designSystem: { value: "bento-ops", from: "organization" },
      colourProfile: { value: "navy-pop", from: "user" },
    });
    expect(me.colourProfile).toBe("navy-pop");

    await ctx.portal.writeMine(ctx.member, { designSystem: null, colourProfile: null });
    const fallen = currentUserResponseSchema.parse(await ctx.access.currentUser(ctx.member));
    expect(fallen.appearance.colourProfile).toEqual({ value: "ocean", from: "portal" });

    const admin = currentUserResponseSchema.parse(await ctx.access.currentUser(ctx.globalAdmin));
    expect(admin.appearance.designSystem.from).not.toBe("organization");
  } finally {
    await ctx.fleetPool.query("UPDATE bms.users SET design_system = $2, colour_profile = $3 WHERE id = $1", [
      ctx.memberId,
      ownBefore.design_system,
      ownBefore.colour_profile,
    ]);
    await ctx.fleetPool.query("UPDATE bms.organizations SET design_system = $2, colour_profile = $3 WHERE id = $1", [
      ctx.memberOrgId,
      orgBefore.design_system,
      orgBefore.colour_profile,
    ]);
    await restorePortal(ctx, portalBefore);
  }
}

/** A8 — Postgres refuses an out-of-list value on a user row (the CHECK, not only the API). */
export async function theUserCheckRefusesAnUnknownName(ctx: AppearanceCtx): Promise<void> {
  await expect(ctx.fleetPool.query("UPDATE bms.users SET colour_profile = 'teal' WHERE id = $1", [ctx.memberId])).rejects.toThrow(
    /users_colour_profile_check/,
  );
}

/**
 * A9 — the privileges as installed (the migration's GRANT/REVOKE, not only its text): the tenant
 * pool reads the portal row and cannot write it; the fleet pool updates it and cannot insert or
 * delete; only the fleet pool may update the two user columns; `bms_auth` reads them.
 */
export async function thePrivilegesAreTheMigrations(ctx: AppearanceCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<Record<string, boolean>>(`
    SELECT
      has_table_privilege('bms_tenant', 'bms.portal_settings', 'SELECT') AS tenant_select,
      has_table_privilege('bms_tenant', 'bms.portal_settings', 'UPDATE') AS tenant_update,
      has_table_privilege('bms_fleet', 'bms.portal_settings', 'UPDATE') AS fleet_update,
      has_table_privilege('bms_fleet', 'bms.portal_settings', 'INSERT') AS fleet_insert,
      has_table_privilege('bms_fleet', 'bms.portal_settings', 'DELETE') AS fleet_delete,
      has_table_privilege('bms_auth', 'bms.portal_settings', 'SELECT') AS auth_select,
      has_column_privilege('bms_auth', 'bms.users', 'colour_profile', 'SELECT') AS auth_user_select,
      has_column_privilege('bms_auth', 'bms.users', 'colour_profile', 'UPDATE') AS auth_user_update,
      has_column_privilege('bms_tenant', 'bms.users', 'design_system', 'UPDATE') AS tenant_user_update,
      has_column_privilege('bms_fleet', 'bms.users', 'design_system', 'UPDATE') AS fleet_user_update`);
  expect(rows[0]).toEqual({
    tenant_select: true,
    tenant_update: false,
    fleet_update: true,
    fleet_insert: false,
    fleet_delete: false,
    auth_select: false,
    auth_user_select: true,
    auth_user_update: false,
    tenant_user_update: false,
    fleet_user_update: true,
  });
}
