import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type pg from "pg";

import type { EnergyOrganizationViews, EnergyView, JwtPayload } from "@bms/shared";

import type { TreeFixture } from "../auth/location-tree.integration.spec";
import type { ReportsController } from "./reports.controller";

/**
 * `F4.298` U4 (ADR 0108 decisions 2.2, 2.5 and 2.9, "Verification owed") —
 * the real `ReportsController` → `EnergyViewService` → `ReportScopeService`
 * path on the `F2.10` tree fixture (`buildTreeFixture`):
 *
 *     F210-A:  R ── A ── A1 ── A1a        F210-B:  X ── X1
 *               └── B ── B1
 *
 * One asset per node; `grantee` (location_admin) holds A, so it reads A, A1
 * and A1a. Every expectation is computed from the ids the fixture inserted.
 *
 * **Telemetry inside the rolled-back transaction.** The view reads
 * `point_values_1m` for a range of three hours or less. The fixture's samples
 * sit two minutes in the future: a refresh never materializes a bucket past
 * `now()` (`refreshAggregatesFrom` caps its window at `Date.now()`, and the
 * policy's end offset is a minute), so those buckets are always served by the
 * real-time branch over the raw hypertable, which sees this transaction's
 * uncommitted rows. No row outlives the suite.
 *
 * `telemetry` is the statement log of a recording wrapper around the fleet
 * pool the service reads telemetry on: a refusal must leave it empty, and the
 * paired positive case shows the same log fills when a read runs.
 *
 * Vitest entry point (and the transaction the fixture lives in): the sibling
 * `.test.ts`.
 */

export type Recorder = { readonly statements: string[] };

export type EnergyViewHarness = {
  readonly controller: ReportsController;
  readonly recorder: Recorder;
  readonly fx: TreeFixture;
  readonly admin: JwtPayload;
};

/** The grid figure of A's asset; B's asset (outside the grantee's grant) is far larger. */
export const READABLE_KW = 10;
export const UNREADABLE_KW = 1_000;
const MINUTE_MS = 60_000;

function fail(message: string): never {
  throw new Error(message);
}

/** The recording wrapper: every statement text, then the real pool's answer. */
export function recordingPool(pool: pg.Pool): { pool: pg.Pool; recorder: Recorder } {
  const statements: string[] = [];
  const wrapper = {
    query: (text: string, params?: unknown[]) => {
      statements.push(text);
      return pool.query(text, params);
    },
  };
  return { pool: wrapper as unknown as pg.Pool, recorder: { statements } };
}

/** `kw` samples two minutes ahead for the assets of A (readable) and B (not readable by the grantee). */
export async function insertFutureSamples(pool: pg.Pool, fx: TreeFixture): Promise<void> {
  const at = new Date(Date.now() + 2 * MINUTE_MS);
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
     VALUES ($1, $2, 'kw', $3, 'kW'), ($1, $4, 'kw', $5, 'kW')`,
    [at, fx.assets.A, READABLE_KW, fx.assets.B, UNREADABLE_KW],
  );
}

/** A custom range around the future samples: ≤ 3 h, so the view reads `_1m`. */
function aroundNow(): { range: "custom"; from: string; to: string } {
  const now = Date.now();
  return {
    range: "custom",
    from: new Date(now - 60 * MINUTE_MS).toISOString(),
    to: new Date(now + 10 * MINUTE_MS).toISOString(),
  };
}

function telemetryStatements(recorder: Recorder): string[] {
  return recorder.statements.filter((text) => text.includes("telemetry."));
}

async function refusal(promise: Promise<unknown>, what: string): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  return fail(`${what}: resolved, expected a refusal`);
}

/**
 * The owed case: the grantee names R. R's subtree holds six sites, the
 * grantee reads three, and the kWh holds A's asset only — B's far larger
 * figure, inside the subtree and outside the grant, is absent.
 */
export async function aParentWithUnreadableChildrenIsPartialAndExcludesTheirAssets(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const view = (await h.controller.energyView(h.fx.grantee, { ...aroundNow(), locationIds: [h.fx.nodes.R] })) as EnergyView;
  if (JSON.stringify(view.partial) !== JSON.stringify({ readableSites: 3, selectedSites: 6 })) {
    fail(`partial: ${JSON.stringify(view.partial)}, expected 3 of 6 sites`);
  }
  if (view.level !== "1m") fail(`level: ${view.level}, expected 1m for a range of 70 minutes`);
  if (!view.current.hasData) fail("the readable asset's future sample was not read — the fixture is not visible");
  if (view.current.peakKw !== READABLE_KW) {
    fail(`peakKw: ${view.current.peakKw}, expected ${READABLE_KW} (A's asset alone; ${UNREADABLE_KW} is B's, outside the grant)`);
  }
  const consumers = view.topConsumers.map((c) => c.assetId);
  if (JSON.stringify(consumers) !== JSON.stringify([h.fx.assets.A])) {
    fail(`topConsumers: ${JSON.stringify(consumers)}, expected only A's asset`);
  }
  for (const id of [h.fx.nodes.B, h.fx.nodes.B1, h.fx.assets.B, h.fx.assets.B1]) {
    if (JSON.stringify(view).includes(id)) fail(`the response names ${id}, which the grantee cannot read`);
  }
  if (telemetryStatements(h.recorder).length === 0) fail("no telemetry statement was recorded — the recorder is dead");
}

/**
 * An inactive site is not a selected site. `foreignOrgAdmin` (organization_admin
 * of B) reads every active location of B; with X1 made inactive, naming X is
 * one site of one, so the page shows no partial note. The positive first: with
 * X1 active, the same request counts two of two (the fixture is visible). The
 * flag is restored inside the suite's transaction.
 */
export async function anInactiveChildIsNotCountedAsAnUnreadableSite(h: EnergyViewHarness, pool: pg.Pool): Promise<void> {
  const before = (await h.controller.energyView(h.fx.foreignOrgAdmin, { ...aroundNow(), locationIds: [h.fx.nodes.X] })) as EnergyView;
  if (JSON.stringify(before.partial) !== JSON.stringify({ readableSites: 2, selectedSites: 2 })) {
    fail(`partial with X1 active: ${JSON.stringify(before.partial)}, expected 2 of 2 sites`);
  }
  await pool.query("UPDATE bms.locations SET active = false WHERE id = $1", [h.fx.nodes.X1]);
  try {
    const view = (await h.controller.energyView(h.fx.foreignOrgAdmin, { ...aroundNow(), locationIds: [h.fx.nodes.X] })) as EnergyView;
    if (JSON.stringify(view.partial) !== JSON.stringify({ readableSites: 1, selectedSites: 1 })) {
      fail(`partial with X1 inactive: ${JSON.stringify(view.partial)}, expected 1 of 1 site (an inactive child is not unreadable)`);
    }
  } finally {
    await pool.query("UPDATE bms.locations SET active = true WHERE id = $1", [h.fx.nodes.X1]);
  }
}

/** Cross-tenant: `organizationId` of B for a caller scoped to A is a 403, and no telemetry is read. */
export async function anotherOrganizationIdIsA403WithNoTelemetry(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const err = await refusal(h.controller.energyView(h.fx.grantee, { range: "today", organizationId: h.fx.orgB }), "organizationId=B");
  if (!(err instanceof ForbiddenException)) fail(`organizationId=B: ${err.name} ${err.message}, expected a 403`);
  if (telemetryStatements(h.recorder).length !== 0) fail(`telemetry read on a refusal: ${telemetryStatements(h.recorder).length}`);
}

/** Cross-tenant: a site of B as `locationIds` is a 403, and no telemetry is read. */
export async function aSiteOfAnotherOrganizationIsA403WithNoTelemetry(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const err = await refusal(h.controller.energyView(h.fx.grantee, { range: "today", locationIds: [h.fx.nodes.X] }), "locationIds=X");
  if (!(err instanceof ForbiddenException)) fail(`locationIds=X: ${err.name} ${err.message}, expected a 403`);
  if (telemetryStatements(h.recorder).length !== 0) fail(`telemetry read on a refusal: ${telemetryStatements(h.recorder).length}`);
}

/**
 * Cross-tenant: `organizationId` A with a site of B is a 403, not the 400
 * "organization mismatch": the locations and their grant resolve first.
 */
export async function ownOrganizationWithAForeignSiteIsA403(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const err = await refusal(
    h.controller.energyView(h.fx.grantee, { range: "today", organizationId: h.fx.orgA, locationIds: [h.fx.nodes.X] }),
    "organizationId=A, locationIds=X",
  );
  if (err instanceof BadRequestException) fail(`a foreign site reached the organization comparison: ${err.message}`);
  if (!(err instanceof ForbiddenException)) fail(`organizationId=A, locationIds=X: ${err.name} ${err.message}, expected a 403`);
  if (telemetryStatements(h.recorder).length !== 0) fail(`telemetry read on a refusal: ${telemetryStatements(h.recorder).length}`);
}

/** The global admin with A's site and `organizationId` B: a readable site of another organization is the 400. */
export async function aReadableSiteWithAnotherOrganizationIsA400(h: EnergyViewHarness): Promise<void> {
  const err = await refusal(
    h.controller.energyView(h.admin, { range: "today", organizationId: h.fx.orgB, locationIds: [h.fx.nodes.A] }),
    "admin, organizationId=B, locationIds=A",
  );
  if (!(err instanceof BadRequestException)) fail(`admin mismatch: ${err.name} ${err.message}, expected a 400`);
}

// ---------------------------------------------------------------------------
// `F4.299` U4 (ADR 0108 Amendment 1, 7.8, "Verification owed (added)") — the
// organization views on the same fixture and the same recorder: the refusals
// run no telemetry statement, and naming R leaves B's asset and B's location
// out of every section, each with the readable A figure beside it.
// ---------------------------------------------------------------------------

const UNREADABLE_IDS = (h: EnergyViewHarness) => [h.fx.nodes.B, h.fx.nodes.B1, h.fx.assets.B, h.fx.assets.B1];
const READABLE_SITES = (h: EnergyViewHarness) => new Set([h.fx.nodes.A, h.fx.nodes.A1, h.fx.nodes.A1a]);

async function organizationViewsOfR(h: EnergyViewHarness): Promise<{ views: EnergyOrganizationViews; view: EnergyView }> {
  const query = { ...aroundNow(), locationIds: [h.fx.nodes.R] };
  const views = (await h.controller.energyOrganizationViews(h.fx.grantee, query)) as EnergyOrganizationViews;
  const view = (await h.controller.energyView(h.fx.grantee, query)) as EnergyView;
  if (!view.current.hasData) fail("the readable asset's future sample was not read — the fixture is not visible");
  return { views, view };
}

/** Cross-tenant: `organizationId` of B for a caller scoped to A is a 403, and no telemetry is read. */
export async function organizationViewsOfAnotherOrganizationIdIsA403WithNoTelemetry(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const err = await refusal(
    h.controller.energyOrganizationViews(h.fx.grantee, { range: "today", organizationId: h.fx.orgB }),
    "organization-views, organizationId=B",
  );
  if (!(err instanceof ForbiddenException)) fail(`organizationId=B: ${err.name} ${err.message}, expected a 403`);
  if (telemetryStatements(h.recorder).length !== 0) fail(`telemetry read on a refusal: ${telemetryStatements(h.recorder).length}`);
}

/** Cross-tenant: a site of B as `locationIds` is a 403, and no telemetry is read. */
export async function organizationViewsOfASiteOfAnotherOrganizationIsA403WithNoTelemetry(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const err = await refusal(
    h.controller.energyOrganizationViews(h.fx.grantee, { range: "today", locationIds: [h.fx.nodes.X] }),
    "organization-views, locationIds=X",
  );
  if (!(err instanceof ForbiddenException)) fail(`locationIds=X: ${err.name} ${err.message}, expected a 403`);
  if (telemetryStatements(h.recorder).length !== 0) fail(`telemetry read on a refusal: ${telemetryStatements(h.recorder).length}`);
}

/**
 * Naming R: `partial` 3 of 6, and the ranking holds readable sites only — A,
 * by its `bms.locations.name` (never the asset's `site_name`), at A's figure;
 * Σ kWh equals the view's total, so B's far larger figure is absent.
 */
export async function organizationViewsRankingHoldsReadableSitesOnly(h: EnergyViewHarness): Promise<void> {
  h.recorder.statements.length = 0;
  const { views, view } = await organizationViewsOfR(h);
  if (JSON.stringify(views.partial) !== JSON.stringify({ readableSites: 3, selectedSites: 6 })) {
    fail(`partial: ${JSON.stringify(views.partial)}, expected 3 of 6 sites`);
  }
  const ids = views.sites.current.map((s) => s.locationId);
  const readable = READABLE_SITES(h);
  if (!ids.includes(h.fx.nodes.A)) fail(`the ranking lacks A: ${JSON.stringify(ids)} — the readable figure is not read`);
  const outside = ids.filter((id) => !readable.has(id));
  if (outside.length > 0) fail(`the ranking names ${JSON.stringify(outside)}, outside A, A1, A1a`);
  const a = views.sites.current.find((s) => s.locationId === h.fx.nodes.A);
  if (!/^F2\.10 F210-.+-A$/.test(a?.name ?? "")) fail(`A's name: ${a?.name}, expected its bms.locations.name`);
  if (a?.peakKw !== READABLE_KW) fail(`A's peakKw: ${a?.peakKw}, expected ${READABLE_KW}`);
  const total = views.sites.current.reduce((sum, s) => sum + s.kwh, 0);
  if (Math.abs(total - view.current.totalKwh) > 0.011) fail(`Σ sites kWh ${total} ≠ the view's totalKwh ${view.current.totalKwh}`);
  if (views.sites.current.some((s) => s.peakKw >= UNREADABLE_KW)) fail("a site carries B's unreadable figure");
  if (telemetryStatements(h.recorder).length === 0) fail("no telemetry statement was recorded — the recorder is dead");
}

/** Naming R: the trend's columns are readable sites, and its largest point is A's figure, never B's. */
export async function organizationViewsTrendHoldsReadableSitesOnly(h: EnergyViewHarness): Promise<void> {
  const { views } = await organizationViewsOfR(h);
  const readable = READABLE_SITES(h);
  const siteColumns = views.trend.columns.flatMap((c) => (c.kind === "site" ? [c.locationId] : []));
  if (!siteColumns.includes(h.fx.nodes.A)) fail(`the trend lacks A's column: ${JSON.stringify(views.trend.columns)}`);
  if (siteColumns.some((id) => !readable.has(id))) fail(`the trend names a site outside A, A1, A1a: ${JSON.stringify(siteColumns)}`);
  const peak = Math.max(0, ...views.trend.points.flatMap((p) => p.kw));
  if (peak !== READABLE_KW) fail(`the trend's largest point: ${peak}, expected ${READABLE_KW} (A alone; ${UNREADABLE_KW} is B's)`);
}

/** Naming R: Σ heatmap cells equals the view's total (A alone) and is above zero. */
export async function organizationViewsHeatmapHoldsReadableKwhOnly(h: EnergyViewHarness): Promise<void> {
  const { views, view } = await organizationViewsOfR(h);
  const total = views.heatmap.cells.reduce((sum, c) => sum + c.kwh, 0);
  if (!(total > 0)) fail(`the heatmap is empty: ${JSON.stringify(views.heatmap.cells)} — the readable figure is not read`);
  if (Math.abs(total - view.current.totalKwh) > 0.011) fail(`Σ heatmap kWh ${total} ≠ the view's totalKwh ${view.current.totalKwh}`);
}

/** Naming R: the abnormal list judges A's asset (no history yet) and names nothing of B. */
export async function organizationViewsAbnormalHoldsReadableEntitiesOnly(h: EnergyViewHarness): Promise<void> {
  const { views } = await organizationViewsOfR(h);
  const a = views.abnormal.entries.find((e) => e.kind === "asset" && e.id === h.fx.assets.A);
  if (a?.verdict !== "not_enough_history") fail(`A's asset: ${JSON.stringify(a)}, expected a not_enough_history entry`);
  const text = JSON.stringify(views.abnormal);
  for (const id of UNREADABLE_IDS(h)) {
    if (text.includes(id)) fail(`the abnormal list names ${id}, which the grantee cannot read`);
  }
  if (views.abnormal.entries.some((e) => e.currentKwh >= UNREADABLE_KW / 60)) fail("an abnormal entry carries B's figure");
  const whole = JSON.stringify(views);
  for (const id of UNREADABLE_IDS(h)) {
    if (whole.includes(id)) fail(`the organization views name ${id}, which the grantee cannot read`);
  }
}

/**
 * `filter-options` takes no input, so it cannot be asked for B: the grantee's
 * answer names organization A and its readable sites (the positive), and no
 * organization or location of B.
 */
export async function filterOptionsNeverListsAnotherOrganization(h: EnergyViewHarness): Promise<void> {
  const options = await h.controller.energyFilterOptions(h.fx.grantee);
  const organizations = options.organizations.map((o) => o.id);
  if (JSON.stringify(organizations) !== JSON.stringify([h.fx.orgA])) fail(`organizations: ${JSON.stringify(organizations)}, expected [A]`);
  const sites = options.locations.map((l) => l.id).sort();
  const expected = [h.fx.nodes.A, h.fx.nodes.A1, h.fx.nodes.A1a].sort();
  if (JSON.stringify(sites) !== JSON.stringify(expected)) fail(`locations: ${JSON.stringify(sites)}, expected A, A1, A1a`);
  const text = JSON.stringify(options);
  for (const id of [h.fx.orgB, h.fx.nodes.X, h.fx.nodes.X1, h.fx.nodes.R]) {
    if (text.includes(id)) fail(`filter-options names ${id}, which the grantee cannot read`);
  }
  const a = options.locations.find((l) => l.id === h.fx.nodes.A);
  if (a?.parentId !== null) fail(`A's parent R is not readable, so its parentId must be null, got ${a?.parentId}`);
}
