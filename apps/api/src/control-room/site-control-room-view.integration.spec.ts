import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { siteControlRoomViews } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import type { SiteControlRoomViewService } from "./site-control-room-view.service";

/**
 * `F3.67` — `SiteControlRoomViewService` against real, non-owner roles (plan
 * U3, S1–S14; step-5 review S15–S17). `site-control-room-view.integration.test.ts` owns the pools and
 * the cleanup; the assertions live here (ADR 0014, AGENTS.md §4.6).
 *
 * **The service commits** (its write opens `withTenant`), so nothing here can
 * roll back. Every fixture — location, asset group, dashboard — is written as
 * `bms_fleet` with a per-run `F367-<run>-…` code or `f367-<run>-…` slug,
 * registered in `ctx.created` the moment it exists, and removed child-first by
 * the test file's `afterAll`; a killed run is reaped by its stale sweep.
 *
 * **Fixture locations are `active = false`.** `access-control-rls` counts
 * every active location as the global admin's scope, and a concurrent run has
 * turned that count red before (`locations.rls.integration.test.ts`).
 * `canManageLocation` and the global admin's `resolve` do not filter on
 * `active`, so no case here needs an active fixture; S11a, which needs a site
 * in `organization_admin`'s (active-only) read scope, reads a seeded PHEWB
 * site and writes nothing to it.
 */
export type SiteViewCtx = {
  svc: SiteControlRoomViewService;
  fleetPool: pg.Pool;
  tenantDb: BmsDb;
  run: string;
  phewbId: string;
  eskomId: string;
  pheAdminUserId: string;
  created: { locations: string[]; groups: string[]; dashboards: string[] };
};

const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000367";

/** A JWT whose `sub` matches no user: the service must resolve the actor by email. */
export function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

export const ADMIN_EMAIL = "admin@bms.local";
export const PHE_ADMIN_EMAIL = "phe-admin@bms.local";
export const ASSET_GROUP_ADMIN_EMAIL = "wc-hvac-admin@bms.local";

const admin = (): JwtPayload => jwtFor(ADMIN_EMAIL, "admin");
const pheAdmin = (): JwtPayload => jwtFor(PHE_ADMIN_EMAIL, "organization_admin");

/** A fresh inactive location under `org`, written as `bms_fleet` and registered. */
async function newSite(ctx: SiteViewCtx, org: string, suffix: string): Promise<string> {
  const code = `F367-${ctx.run}-${suffix}`;
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, false) RETURNING id`,
    [org, code, code.toLowerCase(), `F3.67 ${suffix}`],
  );
  const id = rows[0]?.id as string;
  ctx.created.locations.push(id);
  return id;
}

async function newGroup(ctx: SiteViewCtx, org: string, locationId: string, suffix: string): Promise<string> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [org, locationId, `F367-${ctx.run}-${suffix}`, `F3.67 ${suffix}`],
  );
  const id = rows[0]?.id as string;
  ctx.created.groups.push(id);
  return id;
}

async function newDashboard(
  ctx: SiteViewCtx,
  org: string,
  suffix: string,
  scope: { locationId?: string; assetGroupId?: string },
): Promise<string> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id, asset_group_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org, `f367-${ctx.run}-${suffix}`.toLowerCase(), `F3.67 ${suffix}`, scope.locationId ?? null, scope.assetGroupId ?? null],
  );
  const id = rows[0]?.id as string;
  ctx.created.dashboards.push(id);
  return id;
}

/** The stored rows for a site, read as `bms_fleet` (never `bms_owner`: FORCE would hide them). */
async function storedRows(
  ctx: SiteViewCtx,
  locationId: string,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await ctx.fleetPool.query(
    `SELECT organization_id, kind, dashboard_id, builtin_key, updated_at, updated_by
       FROM bms.site_control_room_views WHERE location_id = $1`,
    [locationId],
  );
  return rows;
}

/** S1 — a site with no row reads as `generated` with nulls, not a 404. */
export async function assertFreshSiteReadsGenerated(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s1");
  expect(await ctx.svc.getSetting(pheAdmin(), site)).toEqual({
    locationId: site,
    organizationId: ctx.phewbId,
    kind: "generated",
    dashboardId: null,
    builtinKey: null,
    updatedAt: null,
    updatedBy: null,
  });
}

/** S2a — a site-scoped dashboard is written under the site's organization, by the real user id. */
export async function assertDashboardWriteLandsUnderTheTenant(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s2a");
  const dash = await newDashboard(ctx, ctx.phewbId, "s2a", { locationId: site });

  const dto = await ctx.svc.putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash });
  expect(dto.dashboardId).toBe(dash);
  expect(dto.kind).toBe("dashboard");

  const rows = await storedRows(ctx, site);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.organization_id).toBe(ctx.phewbId);
  expect(rows[0]?.dashboard_id).toBe(dash);
  // The harness `sub` is synthetic: only the id read back from bms.users is valid here.
  expect(rows[0]?.updated_by).toBe(ctx.pheAdminUserId);
}

/** S2b — the write leaves an audit row naming the action, the organization and the site. */
export async function assertDashboardWriteIsAudited(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s2b");
  const dash = await newDashboard(ctx, ctx.phewbId, "s2b", { locationId: site });
  await ctx.svc.putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash });

  const { rows } = await ctx.fleetPool.query(
    `SELECT action, organization_id, entity_id, actor_id FROM bms.audit_log
      WHERE entity_type = 'site_control_room_view' AND entity_id = $1`,
    [site],
  );
  expect(rows).toEqual([
    {
      action: "master.location.control_room_view.set",
      organization_id: ctx.phewbId,
      entity_id: site,
      actor_id: ctx.pheAdminUserId,
    },
  ]);
}

/** S3 — a dashboard scoped to one of the site's asset groups is accepted. */
export async function assertGroupScopedDashboardIsAccepted(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s3");
  const group = await newGroup(ctx, ctx.phewbId, site, "s3");
  const dash = await newDashboard(ctx, ctx.phewbId, "s3", { assetGroupId: group });

  const dto = await ctx.svc.putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash });
  expect(dto.dashboardId).toBe(dash);
}

/** S4 — a dashboard scoped to another site of the same organization: refused for scope, not organization. */
export async function assertOtherSiteDashboardIsRefused(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s4");
  const other = await newSite(ctx, ctx.phewbId, "s4-other");
  const dash = await newDashboard(ctx, ctx.phewbId, "s4", { locationId: other });

  const error = await ctx.svc
    .putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash })
    .then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/scoped to this site/);
  expect((error as Error).message).not.toMatch(/organization/);
  expect(await storedRows(ctx, site)).toHaveLength(0);
}

/** S5 — another organization's dashboard is refused as another organization's. */
export async function assertOtherOrganizationDashboardIsRefused(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s5");
  const eskomSite = await newSite(ctx, ctx.eskomId, "s5-eskom");
  const dash = await newDashboard(ctx, ctx.eskomId, "s5", { locationId: eskomSite });

  await expect(
    ctx.svc.putSetting(admin(), site, { kind: "dashboard", dashboardId: dash }),
  ).rejects.toThrow(/organization/);
  expect(await storedRows(ctx, site)).toHaveLength(0);
}

/** S6 — a second write updates the one row and moves `updated_at` forward. */
export async function assertSecondWriteUpserts(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s6");
  const first = await ctx.svc.putSetting(pheAdmin(), site, { kind: "generated" });
  const second = await ctx.svc.putSetting(pheAdmin(), site, { kind: "generated" });

  expect(await storedRows(ctx, site)).toHaveLength(1);
  expect(Date.parse(second.updatedAt as string)).toBeGreaterThan(Date.parse(first.updatedAt as string));
}

/** S7a — `phe-admin` reading `RSMOC-WC` (ESKOM) is refused by scope. */
export async function assertOutOfScopeReadIsRefused(ctx: SiteViewCtx, rsmocWcId: string): Promise<void> {
  await expect(ctx.svc.getSetting(pheAdmin(), rsmocWcId)).rejects.toThrow(/access scope/);
}

/** S7b — `phe-admin` writing an ESKOM site is refused by scope, and writes nothing. */
export async function assertOutOfScopeWriteIsRefused(ctx: SiteViewCtx): Promise<void> {
  const eskomSite = await newSite(ctx, ctx.eskomId, "s7b");
  await expect(
    ctx.svc.putSetting(pheAdmin(), eskomSite, { kind: "generated" }),
  ).rejects.toThrow(/access scope/);
  expect(await storedRows(ctx, eskomSite)).toHaveLength(0);
}

/** S8 — an `operator` is refused master-data administration. */
export async function assertOperatorIsRefused(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s8");
  const operator = jwtFor(`f367-operator-${ctx.run}@bms.local`, "operator");
  await expect(ctx.svc.putSetting(operator, site, { kind: "generated" })).rejects.toThrow(
    /Master data administration requires/,
  );
  expect(await storedRows(ctx, site)).toHaveLength(0);
}

/** S9 — deleting the chosen dashboard: resolve fails safe, the setting keeps its evidence. */
export async function assertRemovedDashboardResolvesGenerated(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s9");
  const dash = await newDashboard(ctx, ctx.phewbId, "s9", { locationId: site });
  await ctx.svc.putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash });

  const before = await ctx.svc.resolve(admin(), site);
  expect(before.kind).toBe("dashboard");
  expect(before.dashboardSlug).toBe(`f367-${ctx.run}-s9`.toLowerCase());

  await ctx.fleetPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dash]);

  const after = await ctx.svc.resolve(admin(), site);
  expect(after).toEqual({
    locationId: site,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: "dashboard_removed",
  });
  const setting = await ctx.svc.getSetting(pheAdmin(), site);
  expect(setting.kind).toBe("dashboard");
  expect(setting.dashboardId).toBeNull();
}

/** S10 — re-scoping the chosen dashboard away from the site: `dashboard_out_of_scope`. */
export async function assertRescopedDashboardResolvesOutOfScope(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s10");
  const other = await newSite(ctx, ctx.phewbId, "s10-other");
  const dash = await newDashboard(ctx, ctx.phewbId, "s10", { locationId: site });
  await ctx.svc.putSetting(pheAdmin(), site, { kind: "dashboard", dashboardId: dash });
  expect((await ctx.svc.resolve(admin(), site)).kind).toBe("dashboard");

  await ctx.fleetPool.query(`UPDATE bms.dashboards SET location_id = $2 WHERE id = $1`, [dash, other]);

  const after = await ctx.svc.resolve(admin(), site);
  expect(after.kind).toBe("generated");
  expect(after.notice).toBe("dashboard_out_of_scope");
}

/** S11a — `phe-admin` resolves a PHEWB site in its read scope. */
export async function assertInScopeResolveAnswers(ctx: SiteViewCtx, pheSiteId: string): Promise<void> {
  const resolved = await ctx.svc.resolve(pheAdmin(), pheSiteId);
  expect(resolved.locationId).toBe(pheSiteId);
}

/** S11b — `phe-admin` resolving an ESKOM site gets the 404, not the view. */
export async function assertOutOfScopeResolveIsNotFound(ctx: SiteViewCtx): Promise<void> {
  const eskomSite = await newSite(ctx, ctx.eskomId, "s11b");
  await expect(ctx.svc.resolve(pheAdmin(), eskomSite)).rejects.toThrow(
    /Location not found or outside your access scope/,
  );
}

/** S12 — the policy refuses a row stamped with another organization than the GUC names. */
export async function assertPolicyRefusesMismatchedOrganization(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s12");
  await expect(
    withTenant(ctx.tenantDb, ctx.phewbId, (tx) =>
      tx.insert(siteControlRoomViews).values({
        locationId: site,
        organizationId: ctx.eskomId,
        kind: "generated",
      }),
    ),
  ).rejects.toThrow(/row-level security/);
  expect(await storedRows(ctx, site)).toHaveLength(0);
}

/** S13 — `generated` over a `builtin` row upserts it (plan D3), it does not delete it. */
export async function assertGeneratedOverBuiltinUpserts(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s13");
  await ctx.svc.putSetting(admin(), site, { kind: "builtin", builtinKey: "smoc" });
  expect((await ctx.svc.resolve(admin(), site)).kind).toBe("builtin");

  const dto = await ctx.svc.putSetting(admin(), site, { kind: "generated" });
  expect(dto.kind).toBe("generated");
  expect(dto.builtinKey).toBeNull();
  expect((await ctx.svc.resolve(admin(), site)).notice).toBeNull();

  const rows = await storedRows(ctx, site);
  expect(rows.map((row) => ({ kind: row.kind, builtin_key: row.builtin_key }))).toEqual([
    { kind: "generated", builtin_key: null },
  ]);
}

/**
 * S14 (owner ruling OQ1) — only the global admin sets `builtin`. The
 * `phe-admin` token CLAIMS `admin`: the service must decide on the database
 * role, so a check on the claim reddens this. Positive control in the same
 * case: the real admin writes the same body on a sibling site.
 */
export async function assertBuiltinIsAdminOnly(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s14");
  const sibling = await newSite(ctx, ctx.phewbId, "s14-control");

  await ctx.svc.putSetting(admin(), sibling, { kind: "builtin", builtinKey: "smoc" });
  expect(await storedRows(ctx, sibling)).toHaveLength(1);

  const claimsAdmin = jwtFor(PHE_ADMIN_EMAIL, "admin");
  const error = await ctx.svc
    .putSetting(claimsAdmin, site, { kind: "builtin", builtinKey: "smoc" })
    .then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/global admin/);
  expect((error as Error).message).not.toMatch(/access scope/);
  expect(await storedRows(ctx, site)).toHaveLength(0);
}

/**
 * A fresh PHEWB fixture site whose stored view is `builtin`, written by the real
 * global admin (only it can). `phe-admin` is in scope for it: a PHEWB fixture is
 * the only site a non-admin seed user can manage, since `wc-admin`'s grant is on
 * seeded ESKOM locations, never on a per-run fixture.
 */
async function builtinSite(ctx: SiteViewCtx, suffix: string): Promise<string> {
  const site = await newSite(ctx, ctx.phewbId, suffix);
  await ctx.svc.putSetting(admin(), site, { kind: "builtin", builtinKey: "smoc" });
  return site;
}

/** The refusal a non-admin meets on a builtin site, or `null` if the write went through. */
async function nonAdminReplacesBuiltin(ctx: SiteViewCtx, site: string): Promise<unknown> {
  // The token CLAIMS `admin`: a check on the claim instead of the database role reddens S15a.
  const claimsAdmin = jwtFor(PHE_ADMIN_EMAIL, "admin");
  return ctx.svc
    .putSetting(claimsAdmin, site, { kind: "generated" })
    .then(() => null, (err: unknown) => err);
}

/**
 * S15a (owner ruling OQ3) — replacing a `builtin` view is the global admin's
 * alone: `phe-admin`, in scope, writing `generated` over it gets a 403 that
 * names the REPLACE rule — not OQ1's set-builtin rule, and not the scope guard.
 */
export async function assertNonAdminCannotReplaceBuiltin(ctx: SiteViewCtx): Promise<void> {
  const site = await builtinSite(ctx, "s15a");
  const error = await nonAdminReplacesBuiltin(ctx, site);

  expect(error).toBeInstanceOf(ForbiddenException);
  expect((error as ForbiddenException).getStatus()).toBe(403);
  expect((error as Error).message).toMatch(/global admin may replace a built-in/);
  expect((error as Error).message).not.toMatch(/may set a built-in/);
  expect((error as Error).message).not.toMatch(/access scope/);
}

/** S15b (OQ3) — the refused write leaves the stored row exactly as it was, `updated_at` included. */
export async function assertRefusedReplaceLeavesTheRow(ctx: SiteViewCtx): Promise<void> {
  const site = await builtinSite(ctx, "s15b");
  const before = await storedRows(ctx, site);
  expect(before.map((row) => row.kind)).toEqual(["builtin"]);

  await nonAdminReplacesBuiltin(ctx, site);

  expect(await storedRows(ctx, site)).toEqual(before);
}

/** S15c (OQ3) — positive control: the global admin replaces a builtin view. */
export async function assertAdminCanReplaceBuiltin(ctx: SiteViewCtx): Promise<void> {
  const site = await builtinSite(ctx, "s15c");
  const dto = await ctx.svc.putSetting(admin(), site, { kind: "generated" });
  expect(dto.kind).toBe("generated");
  expect((await storedRows(ctx, site)).map((row) => row.kind)).toEqual(["generated"]);
}

/**
 * The site `wc-hvac-admin@bms.local`'s own asset group sits in, read by email
 * through its grant — never by position.
 */
export async function assetGroupAdminSiteId(ctx: SiteViewCtx): Promise<string> {
  const { rows } = await ctx.fleetPool.query<{ location_id: string }>(
    `SELECT DISTINCT ag.location_id
       FROM bms.asset_groups ag
       JOIN bms.user_asset_group_access uaga ON uaga.asset_group_id = ag.id
       JOIN bms.users u ON u.id = uaga.user_id
      WHERE u.email = $1`,
    [ASSET_GROUP_ADMIN_EMAIL],
  );
  expect(rows, `${ASSET_GROUP_ADMIN_EMAIL}'s groups must sit on one site — run pnpm db:seed`).toHaveLength(1);
  return rows[0]?.location_id as string;
}

/** S16a (ADR 0076 Q14) — an `asset_group_admin` resolves the site its group sits on. */
export async function assertAssetGroupAdminResolvesItsSite(ctx: SiteViewCtx): Promise<void> {
  const site = await assetGroupAdminSiteId(ctx);
  const resolved = await ctx.svc.resolve(jwtFor(ASSET_GROUP_ADMIN_EMAIL, "asset_group_admin"), site);
  expect(resolved.locationId).toBe(site);
}

/**
 * S16b — the same `asset_group_admin` resolving another site gets the 404. The
 * site EXISTS (a per-run ESKOM fixture, the group's own organization): the scope
 * 404 and a missing row's 404 share one message, so a missing id would stay
 * green with the scope check gone.
 */
export async function assertAssetGroupAdminCannotResolveAnotherSite(ctx: SiteViewCtx): Promise<void> {
  const other = await newSite(ctx, ctx.eskomId, "s16b");
  await expect(
    ctx.svc.resolve(jwtFor(ASSET_GROUP_ADMIN_EMAIL, "asset_group_admin"), other),
  ).rejects.toThrow(/Location not found or outside your access scope/);
}

/**
 * S17 — a principal with no grants (`none` scope: an unprovisioned `viewer`
 * claim, the S8 shape) resolving an existing site gets the 404.
 */
export async function assertUngrantedPrincipalCannotResolve(ctx: SiteViewCtx): Promise<void> {
  const site = await newSite(ctx, ctx.phewbId, "s17");
  const viewer = jwtFor(`f367-viewer-${ctx.run}@bms.local`, "viewer");
  expect((await ctx.svc.resolve(admin(), site)).locationId).toBe(site);
  await expect(ctx.svc.resolve(viewer, site)).rejects.toThrow(
    /Location not found or outside your access scope/,
  );
}
