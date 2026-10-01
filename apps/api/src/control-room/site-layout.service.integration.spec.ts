import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import type { JwtPayload } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import type { DashboardTemplatesInstantiateService } from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import type { DashboardsService } from "../dashboard-builder/dashboards.service";
import type { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import type { BmsTx } from "../database/tenant-context";
import {
  SITE_HAS_VIEW_MESSAGE,
  SITE_LAYOUT_AMBIGUOUS_MESSAGE,
  SITE_LAYOUT_CHOICE_MESSAGES,
} from "./site-layout.schema";
import { type SiteViewRowForCopy, SiteLayoutService } from "./site-layout.service";

/**
 * `F3.73` plan Task 4.2 — `SiteLayoutService` (the site-layout copy action) against real,
 * non-owner roles: S1–S6 and S2b of the plan, plus S2c, the race the in-place `UPDATE` exists
 * for. S7–S14 live in `site-layout.service.more.integration.spec.ts` (the 1000-line cap), on the
 * helpers this file exports. `src/testing/site-layout-harness.ts` owns the pools and the cleanup,
 * and `site-layout.service.integration.test.ts` runs these cases; the assertions live here
 * (ADR 0014, AGENTS.md §4.6).
 *
 * **The service commits** (one `withTenant` per site on its own tenant pool), so `withRollback`
 * cannot hold it: the `F3.67` harness shape instead — per-run `F373SL-<run>-…` codes, every
 * fixture registered the moment it exists, a child-first `afterAll`, a stale sweep. Almost every
 * case runs in ONE fixture organization no seed touches (Task 4.3 seeds site templates into
 * ESKOM and PHEWB on the same database), and every call passes `templateId`, so the newest
 * published template of an organization never decides a case.
 *
 * Fixture locations are `active = false`, the `F3.67` reason: `access-control-rls` counts every
 * active location as the global admin's scope. The copy action does not filter on `active`.
 */
export type SiteLayoutCtx = {
  svc: SiteLayoutService;
  /** The same constructor arguments, for S2c's subclass. */
  make: (readViewRow?: (locationId: string) => SiteViewRowForCopy | null) => SiteLayoutService;
  /** S10's read of the copy (`getBySlug`). */
  dashboards: DashboardsService;
  /** S9's read of the copy's mimic nodes (the pool-only `read`). */
  mimicNodes: MimicNodesService;
  /** S13's door: `instantiate` with the real site arm (`siteTemplateArmOf`, the module's factory). */
  instantiate: DashboardTemplatesInstantiateService;
  fleetPool: pg.Pool;
  /** Only for the S6 fixture user and its grant: `bms_fleet` may not write `bms.users`. */
  superuserPool: pg.Pool;
  run: string;
  /** The fixture organization, and its published SMOC-standard template. */
  orgId: string;
  templateId: string;
  eskomId: string;
  rsmocWcId: string;
  created: {
    organizations: string[];
    locations: string[];
    templates: string[];
    users: string[];
  };
};

const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000373";

export function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

export const admin = (): JwtPayload => jwtFor("admin@bms.local", "admin");

/** A fresh organization, registered. */
export async function newOrganization(pool: pg.Pool, run: string, created: SiteLayoutCtx["created"]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency, active) VALUES ($1, $2, 'ZAR', false) RETURNING id`,
    [`F373SL-${run}`, `F3.73 site layout ${run}`],
  );
  const id = rows[0]?.id as string;
  created.organizations.push(id);
  return id;
}

/** A published site template carrying the SMOC standard content, registered. */
export async function newSiteTemplate(
  pool: pg.Pool,
  org: string,
  run: string,
  created: SiteLayoutCtx["created"],
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates
       (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 1, 'SMOC standard (F3.73 fixture)', 'site', 'published', $3::jsonb, 'site', now())
     RETURNING id`,
    [org, `f373sl-${run}`.toLowerCase(), JSON.stringify(SMOC_STANDARD_SITE_TEMPLATE.content)],
  );
  const id = rows[0]?.id as string;
  created.templates.push(id);
  return id;
}

export async function newSite(ctx: SiteLayoutCtx, suffix: string, org: string = ctx.orgId): Promise<string> {
  const code = `F373SL-${ctx.run}-${suffix}`;
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
     VALUES ($1, $2, $3, $4, 'rsmoc', 0, 0, false) RETURNING id`,
    [org, code, code.toLowerCase(), `F3.73 ${suffix}`],
  );
  const id = rows[0]?.id as string;
  ctx.created.locations.push(id);
  return id;
}

/** Assets of the given domains at a site (removed with the site's rows by the cleanup). */
export async function newAssets(
  ctx: SiteLayoutCtx,
  site: string,
  suffix: string,
  domains: string[],
  org: string = ctx.orgId,
): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, domain] of domains.entries()) {
    const code = `F373SL-${ctx.run}-${suffix}-${index}`;
    const { rows } = await ctx.fleetPool.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain, active)
       VALUES ($1, $2, $3, $3, 'F3.73 fixture', $4, true) RETURNING id`,
      [org, site, code, domain],
    );
    ids.push(rows[0]?.id as string);
  }
  return ids;
}

export async function newGroup(ctx: SiteLayoutCtx, site: string, code: string, domain: string, org = ctx.orgId): Promise<string> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.asset_groups (organization_id, location_id, code, name, domain)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [org, site, code, `F3.73 ${code}`, domain],
  );
  return rows[0]?.id as string;
}

/** A site holding one electrical and one environment asset and no group — the S1 shape. */
export async function zeroGroupSite(ctx: SiteLayoutCtx, suffix: string, org: string = ctx.orgId): Promise<string> {
  const site = await newSite(ctx, suffix, org);
  await newAssets(ctx, site, suffix, ["electrical", "electrical", "environment"], org);
  return site;
}

export async function count(ctx: SiteLayoutCtx, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await ctx.fleetPool.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

export const dashboardsAt = (ctx: SiteLayoutCtx, site: string) =>
  count(ctx, `SELECT count(*)::int AS n FROM bms.dashboards WHERE location_id = $1`, [site]);
export const groupsAt = (ctx: SiteLayoutCtx, site: string) =>
  count(ctx, `SELECT count(*)::int AS n FROM bms.asset_groups WHERE location_id = $1`, [site]);

export async function viewRows(ctx: SiteLayoutCtx, site: string): Promise<Array<{ kind: string; dashboard_id: string | null }>> {
  const { rows } = await ctx.fleetPool.query<{ kind: string; dashboard_id: string | null }>(
    `SELECT kind, dashboard_id FROM bms.site_control_room_views WHERE location_id = $1`,
    [site],
  );
  return rows;
}

export async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to be refused");
}

/**
 * S1 — a site with no group and electrical + environment assets: one group per domain (code =
 * domain, `domain` set, every member's role NULL), a template-stamped site dashboard with three
 * tabs, every widget on a tab, the Overview holding exactly the `sld` and `env` cards, the view
 * row `kind = 'dashboard'`, and the three audit actions.
 */
export async function assertZeroGroupSiteGetsGroupsAndACopy(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s1");
  const result = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });

  const { rows: groups } = await ctx.fleetPool.query<{ id: string; code: string; domain: string; members: number; roled: number }>(
    `SELECT g.id, g.code, g.domain, count(m.id)::int AS members, count(m.role)::int AS roled
       FROM bms.asset_groups g LEFT JOIN bms.asset_group_members m ON m.asset_group_id = g.id
      WHERE g.location_id = $1 GROUP BY g.id ORDER BY g.code`,
    [site],
  );
  expect(groups.map((g) => [g.code, g.domain, g.members, g.roled])).toEqual([
    ["electrical", "electrical", 2, 0],
    ["environment", "environment", 1, 0],
  ]);

  const { rows: dash } = await ctx.fleetPool.query<{ id: string; slug: string; template_id: string; location_id: string }>(
    `SELECT id, slug, template_id, location_id FROM bms.dashboards WHERE location_id = $1`,
    [site],
  );
  expect(dash).toHaveLength(1);
  expect(dash[0]?.id).toBe(result.dashboardId);
  expect(dash[0]?.template_id).toBe(ctx.templateId);
  expect(dash[0]?.slug).toBe(result.dashboardSlug);

  const { rows: tabs } = await ctx.fleetPool.query<{ tab_key: string; asset_group_id: string | null }>(
    `SELECT tab_key, asset_group_id FROM bms.dashboard_tabs WHERE dashboard_id = $1 ORDER BY sort_order, tab_key`,
    [result.dashboardId],
  );
  const electrical = groups.find((g) => g.code === "electrical")?.id;
  const environment = groups.find((g) => g.code === "environment")?.id;
  expect(tabs).toEqual([
    { tab_key: "overview", asset_group_id: null },
    { tab_key: "sld", asset_group_id: electrical },
    { tab_key: "env", asset_group_id: environment },
  ]);

  expect(
    await count(ctx, `SELECT count(*)::int AS n FROM bms.dashboard_widgets WHERE dashboard_id = $1 AND tab_id IS NULL`, [
      result.dashboardId,
    ]),
    "every widget of a copy sits on a tab",
  ).toBe(0);
  const { rows: cards } = await ctx.fleetPool.query<{ target: string }>(
    `SELECT w.config->>'targetTabKey' AS target FROM bms.dashboard_widgets w
       JOIN bms.dashboard_tabs t ON t.id = w.tab_id
      WHERE w.dashboard_id = $1 AND t.tab_key = 'overview' AND w.widget_type = 'module_summary_card'
      ORDER BY 1`,
    [result.dashboardId],
  );
  expect(cards.map((c) => c.target)).toEqual(["env", "sld"]);
  expect(result.omittedTabs.map((t) => t.tabKey).sort()).toEqual(["hvac", "it", "ups", "water"]);

  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: result.dashboardId }]);

  const { rows: audits } = await ctx.fleetPool.query<{ action: string; n: number }>(
    `SELECT action, count(*)::int AS n FROM bms.audit_log
      WHERE organization_id = $1 AND (entity_id = $2 OR entity_id = ANY($3::uuid[]))
      GROUP BY action ORDER BY action`,
    [ctx.orgId, site, groups.map((g) => g.id)],
  );
  expect(audits).toEqual([
    { action: "master.asset_group.create", n: 2 },
    { action: "master.location.control_room_view.set", n: 1 },
    { action: "master.location.site_layout.make", n: 1 },
  ]);
}

/** S2 — a second call on a site whose copy is live answers 409 and writes nothing. */
export async function assertSecondCallIsRefused(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s2");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });

  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_HAS_VIEW_MESSAGE);
  expect(await dashboardsAt(ctx, site)).toBe(1);
  expect(await groupsAt(ctx, site)).toBe(2);
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: first.dashboardId }]);
}

/**
 * S2b — the copy is deleted (the view row stays `kind = 'dashboard'` with `dashboard_id` NULL);
 * the action re-makes it and re-points THAT row: one row, now at the new copy.
 * Mutation: drop the `dashboard_id IS NULL` arm of the pre-check → 409 → red.
 */
export async function assertRemovedCopyIsRemadeInPlace(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s2b");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  await ctx.fleetPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [first.dashboardId]);
  expect(await viewRows(ctx, site), "precondition: the delete leaves a removed copy").toEqual([
    { kind: "dashboard", dashboard_id: null },
  ]);

  const again = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  expect(again.dashboardId).not.toBe(first.dashboardId);
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: again.dashboardId }]);
  expect(await groupsAt(ctx, site), "the second copy reuses the groups the first one made").toBe(2);
}

/**
 * S2c — the race the in-place `UPDATE` exists for: the pre-check read a removed copy, and by the
 * write the row is live. The `WHERE` restates `dashboard_id IS NULL`, so the write matches no row,
 * the action answers 409 and the whole copy rolls back.
 * Mutation: drop `dashboard_id IS NULL` from the `UPDATE`'s `WHERE` → the live row is overwritten → red.
 */
export async function assertRaceNeverOverwritesALiveCopy(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s2c");
  const first = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  await ctx.fleetPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [first.dashboardId]);
  // Between the read and the write, an administrator points the view at another site dashboard.
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
     VALUES ($1, $2, 'F3.73 s2c live', $3) RETURNING id`,
    [ctx.orgId, `f373sl-${ctx.run}-s2c-live`.toLowerCase(), site],
  );
  const live = rows[0]?.id as string;
  await ctx.fleetPool.query(`UPDATE bms.site_control_room_views SET dashboard_id = $2 WHERE location_id = $1`, [site, live]);

  const stale = ctx.make(() => ({ kind: "dashboard", dashboardId: null }));
  const err = await caught(stale.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_HAS_VIEW_MESSAGE);
  expect(await viewRows(ctx, site), "a live row is never re-pointed").toEqual([{ kind: "dashboard", dashboard_id: live }]);
  expect(await dashboardsAt(ctx, site), "the refused copy rolled back").toBe(1);
}

/**
 * S2d — the insert arm is the rule, not the pre-check: the read saw no row, and by the write a
 * live row exists. `ON CONFLICT DO NOTHING` writes nothing, the action answers 409, and the copy
 * (its groups included) rolls back.
 * Mutation: `onConflictDoUpdate` → the live row is overwritten → red.
 */
export async function assertInsertNeverOverwritesALiveRow(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s2d");
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id)
     VALUES ($1, $2, 'F3.73 s2d live', $3) RETURNING id`,
    [ctx.orgId, `f373sl-${ctx.run}-s2d-live`.toLowerCase(), site],
  );
  const live = rows[0]?.id as string;
  await ctx.fleetPool.query(
    `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind, dashboard_id)
     VALUES ($1, $2, 'dashboard', $3)`,
    [site, ctx.orgId, live],
  );

  const blind = ctx.make(() => null);
  const err = await caught(blind.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_HAS_VIEW_MESSAGE);
  expect(await viewRows(ctx, site), "a live row is never overwritten").toEqual([{ kind: "dashboard", dashboard_id: live }]);
  expect(await dashboardsAt(ctx, site), "the refused copy rolled back").toBe(1);
  expect(await groupsAt(ctx, site), "the groups the copy made rolled back with it").toBe(0);
}

/**
 * S3b — the template is read under the SITE's organization, so the `instantiate` arm cannot copy
 * one organization's template onto another's site: 404, nothing written.
 * Mutation: drop the `organization_id` term from `readTemplate` → the copy is made → red.
 */
export async function assertForeignTemplateIsNotFound(ctx: SiteLayoutCtx, eskomTemplateId: string): Promise<void> {
  const site = await zeroGroupSite(ctx, "s3b");
  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: site, templateId: eskomTemplateId }));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(await dashboardsAt(ctx, site)).toBe(0);
  expect(await groupsAt(ctx, site)).toBe(0);
}

/**
 * S8b (OQ4) — no `templateId`: the organization's newest published site template, by
 * `published_at`. A second template published a minute later is the one the copy stamps.
 * Mutation: order `published_at` ascending → the older template is stamped → red.
 */
export async function assertNewestPublishedTemplateIsTheDefault(ctx: SiteLayoutCtx): Promise<void> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates
       (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 1, 'SMOC standard (F3.73 newer)', 'site', 'published', $3::jsonb, 'site',
             now() + interval '1 minute')
     RETURNING id`,
    [ctx.orgId, `f373sl-${ctx.run}-newer`.toLowerCase(), JSON.stringify(SMOC_STANDARD_SITE_TEMPLATE.content)],
  );
  const newer = rows[0]?.id as string;
  ctx.created.templates.push(newer);

  const site = await zeroGroupSite(ctx, "s8b");
  const result = await ctx.svc.makeForSite(admin(), { locationId: site });
  const { rows: dash } = await ctx.fleetPool.query<{ template_id: string }>(
    `SELECT template_id FROM bms.dashboards WHERE id = $1`,
    [result.dashboardId],
  );
  expect(dash[0]?.template_id).toBe(newer);
}

/** S3 — RSMOC-WC's builtin row is never replaced: 409, the same sentence. */
export async function assertBuiltinSiteIsRefused(ctx: SiteLayoutCtx, eskomTemplateId: string): Promise<void> {
  const before = await viewRows(ctx, ctx.rsmocWcId);
  expect(before.map((row) => row.kind), "precondition: RSMOC-WC holds the builtin row").toEqual(["builtin"]);
  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: ctx.rsmocWcId, templateId: eskomTemplateId }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_HAS_VIEW_MESSAGE);
  expect(await viewRows(ctx, ctx.rsmocWcId)).toEqual(before);
}

/**
 * S4 — two untaken electrical groups and neither is `electrical`: 409 whose body lists `sld` with
 * both candidates `{ id, code, name }`, and no group, dashboard or view row is written.
 * (`ups` is ambiguous too — the same two candidates — so the body is read by tab, not by length.)
 */
export async function assertAmbiguousSiteAnswersCandidates(ctx: SiteLayoutCtx): Promise<void> {
  const site = await newSite(ctx, "s4");
  await newAssets(ctx, site, "s4", ["electrical"]);
  const a = await newGroup(ctx, site, "electrical-a", "electrical");
  const b = await newGroup(ctx, site, "electrical-b", "electrical");

  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
  expect(err).toBeInstanceOf(ConflictException);
  const body = (err as ConflictException).getResponse() as {
    message: string;
    ambiguous: Array<{ tabKey: string; domain: string; candidates: unknown[] }>;
  };
  expect(body.message).toBe(SITE_LAYOUT_AMBIGUOUS_MESSAGE);
  expect(body.ambiguous.find((tab) => tab.tabKey === "sld")).toEqual({
    tabKey: "sld",
    domain: "electrical",
    candidates: [
      { id: a, code: "electrical-a", name: "F3.73 electrical-a" },
      { id: b, code: "electrical-b", name: "F3.73 electrical-b" },
    ],
  });
  expect(await groupsAt(ctx, site)).toBe(2);
  expect(await dashboardsAt(ctx, site), "an ambiguous site gets no dashboard").toBe(0);
  expect(await viewRows(ctx, site)).toEqual([]);
}

/** S5 — `tabGroups` naming another organization's group: 400, the id never echoed, nothing written. */
export async function assertForeignGroupChoiceIsRefused(ctx: SiteLayoutCtx): Promise<void> {
  const site = await newSite(ctx, "s5");
  await newAssets(ctx, site, "s5", ["electrical"]);
  await newGroup(ctx, site, "electrical-a", "electrical");
  await newGroup(ctx, site, "electrical-b", "electrical");
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY id LIMIT 1`,
    [ctx.eskomId],
  );
  const foreign = rows[0]?.id as string;
  expect(foreign, "precondition: ESKOM holds an asset group").toBeTruthy();

  const err = await caught(
    ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId, tabGroups: { sld: foreign } }),
  );
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as Error).message).toBe(SITE_LAYOUT_CHOICE_MESSAGES.unknown_group);
  expect(JSON.stringify((err as BadRequestException).getResponse())).not.toContain(foreign);
  expect(await dashboardsAt(ctx, site)).toBe(0);
}

/** A location admin fixture user granted exactly one site, registered. */
export async function newLocationAdmin(ctx: SiteLayoutCtx, site: string, suffix: string): Promise<string> {
  const email = `f373sl-${ctx.run}-${suffix}@bms.local`.toLowerCase();
  const { rows } = await ctx.superuserPool.query<{ id: string }>(
    `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
     VALUES ($1, 'x', 'F3.73 location admin', 'location_admin', $2) RETURNING id`,
    [email, ctx.orgId],
  );
  const id = rows[0]?.id as string;
  ctx.created.users.push(id);
  await ctx.superuserPool.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [id, site]);
  return email;
}

/** S6a — the location admin of the site may make its layout (the notice button's caller). */
export async function assertLocationAdminOfTheSiteMayMake(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s6a");
  const email = await newLocationAdmin(ctx, site, "s6a");
  const result = await ctx.svc.makeForSite(jwtFor(email, "location_admin"), {
    locationId: site,
    templateId: ctx.templateId,
  });
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: result.dashboardId }]);
}

/** S6b — a location admin of another site gets the 403 (`assertCanManageLocation`), nothing written. */
export async function assertLocationAdminOfAnotherSiteIsForbidden(ctx: SiteLayoutCtx): Promise<void> {
  const granted = await newSite(ctx, "s6b-own");
  const email = await newLocationAdmin(ctx, granted, "s6b");
  const site = await zeroGroupSite(ctx, "s6b");
  const err = await caught(
    ctx.svc.makeForSite(jwtFor(email, "location_admin"), { locationId: site, templateId: ctx.templateId }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(await dashboardsAt(ctx, site)).toBe(0);
  expect(await groupsAt(ctx, site)).toBe(0);
}

/** S6c — an operator is refused master-data administration (403), nothing written. */
export async function assertOperatorIsForbidden(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s6c");
  const err = await caught(
    ctx.svc.makeForSite(jwtFor(`f373sl-${ctx.run}-op@bms.local`, "operator"), {
      locationId: site,
      templateId: ctx.templateId,
    }),
  );
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(await dashboardsAt(ctx, site)).toBe(0);
}

/** For S2c: a service whose pre-check read answers what the case stages. */
export function serviceWithViewRow(
  base: ConstructorParameters<typeof SiteLayoutService>,
  staged: (locationId: string) => SiteViewRowForCopy | null,
): SiteLayoutService {
  class StagedViewRow extends SiteLayoutService {
    protected override async readViewRow(_tx: BmsTx, locationId: string): Promise<SiteViewRowForCopy | null> {
      return staged(locationId);
    }
  }
  return new StagedViewRow(...base);
}
