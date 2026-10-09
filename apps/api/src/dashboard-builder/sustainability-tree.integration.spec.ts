import { expect } from "vitest";

import type { DashboardCatalogValuesResponse, MetricCatalogValueDto } from "@bms/shared";

import type { MetricCatalogService } from "./metric-catalog.service";

/**
 * `F2.10` U2 — the two sustainability entries over a location tree (ADR 0098 decision 7,
 * Amendment 1 A6, B1, B2, C). Assertions live here; `sustainability-tree.integration.test.ts`
 * owns the committed fixture in an organization it creates. One exported function per claim.
 *
 * The tree: campus (asset C, 1 kWh) → siteA (asset SA, 10 kWh), siteB (asset SB, 100 kWh); the
 * values are distinct powers of ten so every sum names the assets it took. One campus
 * dashboard carries every binding.
 *
 * **The depth-two case cannot prove grouping on this fixture**: the tree is two levels deep, so
 * depth 2 and "no groupDepth" both list the three nodes. It proves B2 (the campus, shallower
 * than depth 2, keeps its own row and the rows still sum to the total); the off-by-one cases
 * at depth 2 and 3 live in the pure `sustainability-grouping.spec.ts`.
 */
export type TreeFixture = {
  readonly service: MetricCatalogService;
  readonly orgId: string;
  readonly campusId: string;
  readonly siteAId: string;
  readonly campusCode: string;
  readonly siteACode: string;
  readonly siteBCode: string;
  readonly campusName: string;
  readonly siteAName: string;
  readonly siteAAssetId: string;
  readonly dashboardId: string;
  readonly totalSourceId: string;
  readonly byNodeSourceId: string;
  readonly depthOneSourceId: string;
  readonly depthTwoSourceId: string;
  /** A second dashboard, at siteA, with one `by_location { groupDepth: 1 }` binding (owner ruling P1). */
  readonly siteADashboardId: string;
  readonly siteADepthOneSourceId: string;
  readonly assetsListSourceId: string;
  /** Hand-inserted past the write schema: `groupDepth` = `LOCATION_TREE_MAX_DEPTH + 1`. */
  readonly tooDeepSourceId: string;
  /** Hand-inserted past the write schema: `groupDepth` = 0. */
  readonly zeroDepthSourceId: string;
};

const valueOf = (response: DashboardCatalogValuesResponse, sourceId: string): MetricCatalogValueDto => {
  const hit = response.values.find((value) => value.sourceId === sourceId);
  if (hit === undefined) throw new Error(`binding ${sourceId} is absent from values`);
  return hit.resolved;
};

const rowsOf = (response: DashboardCatalogValuesResponse, sourceId: string) => {
  const resolved = valueOf(response, sourceId);
  if (resolved.shape !== "dataset") throw new Error(`binding ${sourceId} is not a dataset`);
  return resolved.rows;
};

const resolveAsAdmin = (f: TreeFixture) => f.service.resolveForDashboard(f.orgId, f.dashboardId, null, null);

/** B1: the campus dashboard's total sums the whole subtree — 1 + 10 + 100, three carrying. */
export async function aCampusDashboardTotalSumsTheSubtree(f: TreeFixture): Promise<void> {
  const total = valueOf(await resolveAsAdmin(f), f.totalSourceId);
  if (total.shape !== "metric") throw new Error("sustainability.total must be a metric");
  expect({ value: total.value, coverage: total.coverage }).toEqual({
    value: 111,
    coverage: { fresh: 3, carrying: 3 },
  });
}

/** B1's negative: `assets.list` on the same dashboard is the campus's own asset only. */
export async function assetsListOnTheSameDashboardStaysPerNode(f: TreeFixture): Promise<void> {
  const rows = rowsOf(await resolveAsAdmin(f), f.assetsListSourceId);
  expect(rows.length, "assets.list must stay per node: the campus holds one asset").toBe(1);
}

/** Without `groupDepth`: one row per node in the subtree, in code order. */
export async function byLocationWithoutGroupDepthListsThreeNodes(f: TreeFixture): Promise<void> {
  const rows = rowsOf(await resolveAsAdmin(f), f.byNodeSourceId);
  expect(rows.map((row) => [row.locationCode, row.value])).toEqual([
    [f.campusCode, 1],
    [f.siteACode, 10],
    [f.siteBCode, 100],
  ]);
}

/** B2: depth 1 folds the subtree into the campus row, and that row equals the total. */
export async function byLocationAtDepthOneIsOneCampusRowWhoseValueEqualsTheTotal(f: TreeFixture): Promise<void> {
  const response = await resolveAsAdmin(f);
  const rows = rowsOf(response, f.depthOneSourceId);
  const total = valueOf(response, f.totalSourceId);
  expect(rows.map((row) => [row.locationCode, row.locationName, row.value, row.coverage])).toEqual([
    [f.campusCode, f.campusName, 111, "3/3"],
  ]);
  expect(total.shape === "metric" ? total.value : undefined, "the grouped rows must sum to the total").toBe(
    rows.reduce((sum, row) => sum + Number(row.value), 0),
  );
}

/** B2: at depth 2 the campus is shallower than the depth, so its asset keeps its own row. */
export async function byLocationAtDepthTwoKeepsTheCampusAssetOnItsOwnRow(f: TreeFixture): Promise<void> {
  const rows = rowsOf(await resolveAsAdmin(f), f.depthTwoSourceId);
  expect(rows.map((row) => [row.locationCode, row.value])).toEqual([
    [f.campusCode, 1],
    [f.siteACode, 10],
    [f.siteBCode, 100],
  ]);
}

/**
 * A6 and the Drafter-choice-8 leak negative: a reader granted siteA alone, at depth 1, gets one
 * row labelled siteA — the campus is unreadable to them, so its code and name never appear.
 */
export async function aReaderGrantedSiteAGroupsByItselfAtDepthOne(f: TreeFixture): Promise<void> {
  const response = await f.service.resolveForDashboard(f.orgId, f.dashboardId, [f.siteAAssetId], [f.siteAId]);
  const rows = rowsOf(response, f.depthOneSourceId);
  expect(rows.map((row) => [row.locationCode, row.locationName, row.value])).toEqual([
    [f.siteACode, f.siteAName, 10],
  ]);
  const labels = rows.flatMap((row) => [row.locationCode, row.locationName]);
  expect(labels, "an unreadable ancestor's code must never label a row").not.toContain(f.campusCode);
  expect(labels, "an unreadable ancestor's name must never label a row").not.toContain(f.campusName);
}

/**
 * Owner ruling P1: on the siteA dashboard, read as admin, depth 1 is capped at the dashboard's
 * own node — one row labelled siteA carrying siteA's 10, never the campus label over a value
 * that is not the campus's.
 */
export async function aSiteADashboardAtDepthOneLabelsSiteANeverTheCampus(f: TreeFixture): Promise<void> {
  const response = await f.service.resolveForDashboard(f.orgId, f.siteADashboardId, null, null);
  const rows = rowsOf(response, f.siteADepthOneSourceId);
  expect(rows.map((row) => [row.locationCode, row.locationName, row.value])).toEqual([
    [f.siteACode, f.siteAName, 10],
  ]);
}

/** C: `groupDepth` outside `1..LOCATION_TREE_MAX_DEPTH` fails the write schema and is skipped. */
export async function anOutOfRangeGroupDepthBindingIsSkippedNotThrown(f: TreeFixture): Promise<void> {
  const response = await resolveAsAdmin(f);
  const sourceIds = response.values.map((value) => value.sourceId);
  expect(sourceIds, "the depth-1 binding beside it still resolves (the positive control)").toContain(
    f.depthOneSourceId,
  );
  expect(sourceIds, "groupDepth above the bound must be skipped").not.toContain(f.tooDeepSourceId);
  expect(sourceIds, "groupDepth 0 must be skipped").not.toContain(f.zeroDepthSourceId);
}
