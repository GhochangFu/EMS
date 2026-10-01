import { ConflictException, ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import { siteLayoutDashboardSlug } from "@bms/shared";
import { SMOC_STANDARD_SITE_TEMPLATE } from "@bms/shared/site-templates";

import {
  NO_SITE_TEMPLATE_MESSAGE,
  SITE_HAS_VIEW_MESSAGE,
  SITE_LAYOUT_SLUG_TAKEN_MESSAGE,
} from "./site-layout.schema";
import {
  type SiteLayoutCtx,
  admin,
  caught,
  dashboardsAt,
  groupsAt,
  jwtFor,
  newAssets,
  newGroup,
  newLocationAdmin,
  newOrganization,
  newSite,
  newSiteTemplate,
  viewRows,
  zeroGroupSite,
} from "./site-layout.service.integration.spec";
import { siteLayoutLockKey } from "./site-layout.service";

/**
 * `F3.73` plan Task 4.2 — the rest of the `SiteLayoutService` cases: S7 (bulk), S8 (no published
 * site template), S9 (mimic nodes through the tab group), S10 (`getBySlug` carries the stamp),
 * S11 (a taken slug is a 409), S13 (the `instantiate` site arm) and S14 (two concurrent copies on
 * one site). Split from `site-layout.service.integration.spec.ts` for the 1000-line cap;
 * `src/testing/site-layout-harness.ts` owns the pools and the cleanup, and
 * `site-layout.service.more.integration.test.ts` runs these cases.
 *
 * S7, S8 and S13 each run in their own fixture organization (registered, so the cleanup removes
 * it): the bulk visits every active site of one organization, and "the newest published site
 * template" is an organization-wide fact.
 */

/** The site's own slug, as `newSite` writes it. */
function siteSlug(ctx: SiteLayoutCtx, suffix: string): string {
  return `F373SL-${ctx.run}-${suffix}`.toLowerCase();
}

async function insertDashboard(ctx: SiteLayoutCtx, org: string, slug: string, site: string): Promise<string> {
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name, location_id) VALUES ($1, $2, 'F3.73 fixture', $3) RETURNING id`,
    [org, slug, site],
  );
  return rows[0]?.id as string;
}

async function insertGeneratedView(ctx: SiteLayoutCtx, org: string, site: string): Promise<void> {
  await ctx.fleetPool.query(
    `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind) VALUES ($1, $2, 'generated')`,
    [site, org],
  );
}

/**
 * S7 (ruling Q4) — the bulk makes what it can and reports the rest: six active sites, one of each
 * skip between two that are made. Each site is its own transaction, so site 1's copy survives the
 * skips after it, and the last site is still made — a skip is reported, never raised.
 * Mutation: rethrow a `SiteLayoutConflict` in the loop instead of pushing it → red.
 * Mutation: drop the `dashboards_organization_slug_key` translation → the slug-taken site's raw
 * `23505` aborts the loop → red.
 */
export async function assertBulkMakesAndReportsSkips(ctx: SiteLayoutCtx): Promise<void> {
  const org = await newOrganization(ctx.fleetPool, `${ctx.run}-bulk`, ctx.created);
  const templateId = await newSiteTemplate(ctx.fleetPool, org, `${ctx.run}-bulk`, ctx.created);

  const made1 = await zeroGroupSite(ctx, "s7a", org);
  const hasView = await zeroGroupSite(ctx, "s7b", org);
  await insertGeneratedView(ctx, org, hasView);
  const ambiguous = await newSite(ctx, "s7c", org);
  await newAssets(ctx, ambiguous, "s7c", ["electrical"], org);
  await newGroup(ctx, ambiguous, "electrical-a", "electrical", org);
  await newGroup(ctx, ambiguous, "electrical-b", "electrical", org);
  const noAssets = await newSite(ctx, "s7d", org);
  const slugTaken = await zeroGroupSite(ctx, "s7e", org);
  const squatter = await insertDashboard(ctx, org, siteLayoutDashboardSlug(siteSlug(ctx, "s7e")), slugTaken);
  const made2 = await zeroGroupSite(ctx, "s7f", org);
  const sites = [made1, hasView, ambiguous, noAssets, slugTaken, made2];

  // The bulk visits active sites only. Fixture sites are inactive everywhere else (the `F3.67`
  // reason in the sibling spec's docblock), so they are active for the call and no longer.
  await ctx.fleetPool.query(`UPDATE bms.locations SET active = true WHERE id = ANY($1::uuid[])`, [sites]);
  let result;
  try {
    result = await ctx.svc.makeForOrganization(admin(), templateId);
  } finally {
    await ctx.fleetPool.query(`UPDATE bms.locations SET active = false WHERE id = ANY($1::uuid[])`, [sites]);
  }

  expect(result.made.map((row) => row.locationId), "the sites made, in code order").toEqual([made1, made2]);
  expect(result.skipped.map((row) => [row.locationId, row.reason])).toEqual([
    [hasView, "has_view"],
    [ambiguous, "ambiguous"],
    [noAssets, "no_assets"],
    [slugTaken, "slug_taken"],
  ]);
  const sld = result.skipped[1]?.ambiguous?.find((tab) => tab.tabKey === "sld");
  expect(sld?.candidates.map((c) => c.code), "the ambiguous skip carries its candidates").toEqual([
    "electrical-a",
    "electrical-b",
  ]);

  expect(await viewRows(ctx, made1), "site 1's copy survives the skips after it").toEqual([
    { kind: "dashboard", dashboard_id: result.made[0]?.dashboardId },
  ]);
  expect(await viewRows(ctx, hasView)).toEqual([{ kind: "generated", dashboard_id: null }]);
  expect(await dashboardsAt(ctx, ambiguous)).toBe(0);
  expect(await dashboardsAt(ctx, noAssets)).toBe(0);
  const { rows: onSlug } = await ctx.fleetPool.query<{ id: string }>(`SELECT id FROM bms.dashboards WHERE location_id = $1`, [
    slugTaken,
  ]);
  expect(onSlug.map((row) => row.id), "the slug-taken site keeps only the squatter").toEqual([squatter]);
  expect(await groupsAt(ctx, slugTaken), "the slug-taken copy's groups rolled back").toBe(0);
}

/**
 * S7b — the bulk is an organization-wide act: a location admin is refused (403) before any site.
 * Mutation: drop the whole authorship guard → the bulk answers → red. (Dropping only the
 * `location_admin` term survives: `canManageTemplate` answers false for that role too.)
 */
export async function assertBulkRefusesALocationAdmin(ctx: SiteLayoutCtx): Promise<void> {
  const site = await newSite(ctx, "s7r");
  const email = await newLocationAdmin(ctx, site, "s7r");
  const err = await caught(ctx.svc.makeForOrganization(jwtFor(email, "location_admin"), ctx.templateId));
  expect(err).toBeInstanceOf(ForbiddenException);
}

/**
 * S8 — an organization with no published site template: 409 `NO_SITE_TEMPLATE_MESSAGE`, nothing
 * written. The organization holds a DRAFT site template and a PUBLISHED group template, so the
 * query's status and target terms each decide the answer.
 * Mutation: drop the `status = 'published'` term → the draft is read → another message → red.
 * Mutation: drop the `target = 'site'` term → the group template is read → a 400 → red.
 */
export async function assertNoPublishedSiteTemplateAnswers409(ctx: SiteLayoutCtx): Promise<void> {
  const org = await newOrganization(ctx.fleetPool, `${ctx.run}-empty`, ctx.created);
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 1, 'F3.73 draft site', 'site', 'draft', $3::jsonb, 'site', NULL),
            ($1, $4, 1, 'F3.73 group', 'site', 'published', '{"widgets":[]}'::jsonb, 'asset_group', now() + interval '1 hour')
     RETURNING id`,
    [
      org,
      `f373sl-${ctx.run}-draft`.toLowerCase(),
      JSON.stringify(SMOC_STANDARD_SITE_TEMPLATE.content),
      `f373sl-${ctx.run}-group`.toLowerCase(),
    ],
  );
  ctx.created.templates.push(...rows.map((row) => row.id));
  const site = await zeroGroupSite(ctx, "s8", org);

  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: site }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(NO_SITE_TEMPLATE_MESSAGE);
  expect(await dashboardsAt(ctx, site)).toBe(0);
  expect(await groupsAt(ctx, site)).toBe(0);
}

/**
 * S9 — a copy's mimic resolves through its TAB's group (the dashboard itself has none): the `sld`
 * tab's `electrical_distribution` preset finds the `transformer` member of the `electrical` group.
 * Mutation: write every widget with `tab_id` NULL → the node is unassigned → red.
 */
export async function assertMimicNodesResolveThroughTheTabGroup(ctx: SiteLayoutCtx): Promise<void> {
  const site = await newSite(ctx, "s9");
  const [transformer, sensor] = await newAssets(ctx, site, "s9", ["electrical", "environment"]);
  const electrical = await newGroup(ctx, site, "electrical", "electrical");
  const environment = await newGroup(ctx, site, "environment", "environment");
  await ctx.fleetPool.query(
    `INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, 'transformer'), ($3, $4, NULL)`,
    [electrical, transformer, environment, sensor],
  );

  const result = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const dto = await ctx.mimicNodes.read(ctx.orgId, result.dashboardId, null, Date.now());
  expect(dto.widgets, "the sld and env tabs each carry one preset mimic").toHaveLength(2);
  const resolved = dto.widgets.flatMap((widget) => widget.nodes.filter((node) => node.asset?.id === transformer));
  expect(resolved.map((node) => node.key), "the transformer node resolves through the sld tab's group").toEqual([
    "transformer",
  ]);
}

/**
 * S10 — the copy is template-stamped, and the dashboards read carries the stamp and the tabs:
 * the web knows a copy by `templateId` (ruling Q5).
 */
export async function assertGetBySlugCarriesTheStamp(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s10");
  const result = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const dto = await ctx.dashboards.getBySlug(admin(), result.dashboardSlug, ctx.orgId);
  expect(dto.id).toBe(result.dashboardId);
  expect(dto.templateId).toBe(ctx.templateId);
  expect(dto.tabs.map((tab) => tab.key)).toEqual(["overview", "sld", "env"]);
}

/**
 * S11 — a dashboard already holds `site-layout-<slug>`: 409 `SITE_LAYOUT_SLUG_TAKEN_MESSAGE`, not
 * a 500, and the groups the copy made roll back with it.
 * Mutation: drop the `dashboards_organization_slug_key` translation → a raw `23505` → red.
 */
export async function assertTakenSlugAnswers409(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s11");
  await insertDashboard(ctx, ctx.orgId, siteLayoutDashboardSlug(siteSlug(ctx, "s11")), site);

  const err = await caught(ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
  expect(err).toBeInstanceOf(ConflictException);
  expect((err as Error).message).toBe(SITE_LAYOUT_SLUG_TAKEN_MESSAGE);
  expect(await groupsAt(ctx, site), "the copy's groups rolled back").toBe(0);
  expect(await viewRows(ctx, site)).toEqual([]);
  expect(await dashboardsAt(ctx, site), "only the dashboard that held the slug").toBe(1);
}

/**
 * S13 — `instantiate` on a site template with `{ locationId }`, through the arm `AdminModule`
 * provides: the S1 rows, stamped with THAT template (not the organization's newest), and the
 * copy's three audit actions once each — the arm adds no audit of its own.
 * Mutation: the arm drops `templateId` → the newer template is stamped → red.
 */
export async function assertInstantiateSiteArmMakesTheCopy(ctx: SiteLayoutCtx): Promise<void> {
  const org = await newOrganization(ctx.fleetPool, `${ctx.run}-inst`, ctx.created);
  const older = await newSiteTemplate(ctx.fleetPool, org, `${ctx.run}-inst`, ctx.created);
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 1, 'F3.73 newer', 'site', 'published', $3::jsonb, 'site', now() + interval '1 hour') RETURNING id`,
    [org, `f373sl-${ctx.run}-inst-newer`.toLowerCase(), JSON.stringify(SMOC_STANDARD_SITE_TEMPLATE.content)],
  );
  ctx.created.templates.push(rows[0]?.id as string);
  const site = await zeroGroupSite(ctx, "s13", org);

  const result = (await ctx.instantiate.instantiateSite(admin(), older, { locationId: site })) as {
    dashboardId: string;
  };
  const { rows: dash } = await ctx.fleetPool.query<{ id: string; template_id: string }>(
    `SELECT id, template_id FROM bms.dashboards WHERE location_id = $1`,
    [site],
  );
  expect(dash).toEqual([{ id: result.dashboardId, template_id: older }]);
  const { rows: tabs } = await ctx.fleetPool.query<{ tab_key: string }>(
    `SELECT tab_key FROM bms.dashboard_tabs WHERE dashboard_id = $1 ORDER BY sort_order`,
    [result.dashboardId],
  );
  expect(tabs.map((tab) => tab.tab_key)).toEqual(["overview", "sld", "env"]);
  expect(await viewRows(ctx, site)).toEqual([{ kind: "dashboard", dashboard_id: result.dashboardId }]);
  expect(await groupsAt(ctx, site)).toBe(2);

  const { rows: audits } = await ctx.fleetPool.query<{ action: string; n: number }>(
    `SELECT action, count(*)::int AS n FROM bms.audit_log WHERE organization_id = $1 GROUP BY action ORDER BY action`,
    [org],
  );
  expect(audits, "every audit row of the organization: the copy's, once").toEqual([
    { action: "master.asset_group.create", n: 2 },
    { action: "master.location.control_room_view.set", n: 1 },
    { action: "master.location.site_layout.make", n: 1 },
  ]);
}

/**
 * S14 — two copies on one zero-group site at once. The staging transaction plays the first copy:
 * it holds the per-site lock, makes the `electrical` group and a view row, and commits only once
 * the service's call is seen waiting. The call must then read the committed row and answer 409 —
 * never a raw `23505` on `asset_groups_location_code_idx` (a 500, and an aborted bulk run).
 * Mutation: drop the `pg_advisory_xact_lock` statement → the call collides on the group insert → red.
 */
export async function assertConcurrentCopyAnswers409(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s14");
  const client = await ctx.fleetPool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [siteLayoutLockKey(site)]);
    await client.query(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name, domain)
       VALUES ($1, $2, 'electrical', 'F3.73 s14 first copy', 'electrical')`,
      [ctx.orgId, site],
    );
    await client.query(
      `INSERT INTO bms.site_control_room_views (location_id, organization_id, kind) VALUES ($1, $2, 'generated')`,
      [site, ctx.orgId],
    );

    const call = caught(ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId }));
    await waitForALockWaiter(ctx);
    await client.query("COMMIT");
    open = false;

    const err = await call;
    expect(err, `a concurrent copy answers 409, never ${String(err)}`).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(SITE_HAS_VIEW_MESSAGE);
    expect(await dashboardsAt(ctx, site), "the second copy wrote no dashboard").toBe(0);
    expect(await groupsAt(ctx, site), "only the first copy's group").toBe(1);
    expect(await viewRows(ctx, site)).toEqual([{ kind: "generated", dashboard_id: null }]);
  } finally {
    if (open) {
      await client.query("ROLLBACK");
    }
    client.release();
  }
}

/** `tab:type:title@x,y` of every widget of a copy, in tab then grid order. */
async function copyRects(ctx: SiteLayoutCtx, dashboardId: string): Promise<string[]> {
  const { rows } = await ctx.fleetPool.query<{ widget: string }>(
    `SELECT t.tab_key || ':' || w.widget_type || ':' || coalesce(w.title, '') || '@' || w.grid_x || ',' || w.grid_y AS widget
       FROM bms.dashboard_widgets w JOIN bms.dashboard_tabs t ON t.id = w.tab_id
      WHERE w.dashboard_id = $1
      ORDER BY t.sort_order, w.grid_y, w.grid_x`,
    [dashboardId],
  );
  return rows.map((row) => row.widget);
}

/** One fixture Overview card that opens `targetTabKey`, in slot `slot` of a card row at y2. */
function fixtureCard(targetTabKey: string, title: string, slot: number) {
  return {
    key: `overview-${targetTabKey}-card`,
    title,
    gridX: slot * 2,
    gridY: 2,
    gridW: 2,
    gridH: 3,
    bindings: [],
    sources: [],
    widgetType: "module_summary_card",
    config: { targetTabKey },
  };
}

/**
 * S15a (the F3.73 design critique) — the Overview cards of the tabs a site keeps are packed left
 * in template order: the S1 shape keeps `sld` and `env`, so `env` moves from column 8 to 2.
 * Since `F3.77` the stock Overview holds no card (plan D1), so the case publishes its own site
 * template: the stock tabs behind an Overview of a strip and one card per group tab. It is
 * published a day in the past, so it is never the organization's newest site template.
 * Mutation: `planSiteLayout` filters without `packAfterRemoval` → `env` at 8 → red.
 */
export async function assertKeptCardsArePackedLeft(ctx: SiteLayoutCtx): Promise<void> {
  const [, ...domainTabs] = SMOC_STANDARD_SITE_TEMPLATE.content.tabs;
  const overview = {
    key: "overview",
    label: "Overview",
    sortOrder: 0,
    domain: null,
    widgets: [
      {
        key: "overview-class-strip",
        title: null,
        gridX: 0,
        gridY: 0,
        gridW: 12,
        gridH: 2,
        bindings: [],
        sources: [],
        widgetType: "asset_class_strip",
        config: {},
      },
      fixtureCard("sld", "Electrical", 0),
      fixtureCard("ups", "UPS & battery", 1),
      fixtureCard("hvac", "HVAC", 2),
      fixtureCard("it", "IT", 3),
      fixtureCard("env", "Environment", 4),
      fixtureCard("water", "Water", 5),
    ],
  };
  const { rows } = await ctx.fleetPool.query<{ id: string }>(
    `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status, content, target, published_at)
     VALUES ($1, $2, 1, 'F3.77 cards fixture', 'site', 'published', $3::jsonb, 'site', now() - interval '1 day') RETURNING id`,
    [ctx.orgId, `f373sl-${ctx.run}-s15a-cards`.toLowerCase(), JSON.stringify({ widgets: [], tabs: [overview, ...domainTabs] })],
  );
  const templateId = rows[0]?.id as string;
  ctx.created.templates.push(templateId);

  const site = await zeroGroupSite(ctx, "s15a");
  const result = await ctx.svc.makeForSite(admin(), { locationId: site, templateId });
  const cards = (await copyRects(ctx, result.dashboardId)).filter((w) => w.includes(":module_summary_card:"));
  expect(cards).toEqual(["overview:module_summary_card:Electrical@0,2", "overview:module_summary_card:Environment@2,2"]);
}

/**
 * S15b — a role tile with no point at the site is left out of the copy, and the tab's body moves
 * up into the emptied tile row. The S1 shape makes its groups with every role NULL, so no role
 * tile binds. The Overview's four catalog tiles bind no role and stay: the adjacent positive.
 * Mutation: the service writes `planTemplateWidget`'s plans without `omitUnboundTiles` → red.
 * Mutation: `makeForSite` answers `omittedTiles: []` → the body assertion is red.
 */
export async function assertUnboundRoleTilesAreOmitted(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s15b");
  const result = await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const widgets = await copyRects(ctx, result.dashboardId);
  expect(widgets.filter((w) => w.includes(":value_tile:") && !w.startsWith("overview:"))).toEqual([]);
  expect(widgets.filter((w) => w.startsWith("overview:value_tile:"))).toHaveLength(4);
  expect(widgets.filter((w) => w.startsWith("sld:") || w.startsWith("env:"))).toEqual([
    "sld:mimic:@0,0",
    "sld:active_alarms_rail:Active alarms@0,7",
    "sld:table:Assets@6,7",
    "env:mimic:@0,0",
    "env:active_alarms_rail:Active alarms@0,7",
    "env:table:Assets@6,7",
  ]);
  const tileKeys = result.resolution.flatMap((tab) => tab.widgets.map((w) => w.widgetKey)).filter((key) => key.endsWith("-tile"));
  expect(tileKeys.filter((key) => !key.startsWith("overview-")), "an omitted tile has no resolution row").toEqual([]);
  // ADR 0049 Amendment 2 decision 1: the answer reports every widget, so the tiles that have no
  // resolution row are named here, the way `droppedCards` names a removed card.
  expect(result.omittedTiles.map((tile) => `${tile.tabKey}/${tile.widgetKey}`).sort(), "the answer names each omitted tile").toEqual([
    "env/env-humidity-tile",
    "env/env-temperature-tile",
    "sld/sld-frequency-tile",
    "sld/sld-incomer-kw-tile",
    "sld/sld-incomer-pf-tile",
    "sld/sld-main-bus-kw-tile",
  ]);
}

/**
 * S15c — the make audit names every omitted tile, `tab/widget key`, as it names omitted tabs.
 * Mutation: drop `omittedTiles` from the payload → red.
 */
export async function assertOmittedTilesAreAudited(ctx: SiteLayoutCtx): Promise<void> {
  const site = await zeroGroupSite(ctx, "s15c");
  await ctx.svc.makeForSite(admin(), { locationId: site, templateId: ctx.templateId });
  const { rows } = await ctx.fleetPool.query<{ tiles: string[] }>(
    `SELECT payload->'omittedTiles' AS tiles FROM bms.audit_log
      WHERE organization_id = $1 AND entity_id = $2 AND action = 'master.location.site_layout.make'`,
    [ctx.orgId, site],
  );
  expect(rows.map((row) => row.tiles)).toEqual([
    [
      "sld/sld-incomer-kw-tile",
      "sld/sld-incomer-pf-tile",
      "sld/sld-frequency-tile",
      "sld/sld-main-bus-kw-tile",
      "env/env-temperature-tile",
      "env/env-humidity-tile",
    ],
  ]);
}

/**
 * Polls until a session of this database waits on a lock in a copy statement — the advisory
 * lock with the fix, the group insert's unique index without it. Bounded: a call that never
 * waits fails here rather than racing the commit.
 */
async function waitForALockWaiter(ctx: SiteLayoutCtx): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await ctx.superuserPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()
          AND (query ILIKE '%pg_advisory_xact_lock%' OR query ILIKE '%asset_groups%')`,
    );
    if (Number(rows[0]?.n ?? 0) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("S14: the service's call never waited on a lock");
}
