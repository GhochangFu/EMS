import { expect } from "vitest";

import { MAX_DATASET_ROWS } from "@bms/shared";
import type { DashboardCatalogValuesResponse, MetricCatalogValueDto } from "@bms/shared";

import type { MetricCatalogService } from "./metric-catalog.service";

/**
 * `E4.2` U4 — the sustainability roll-up against real rows (ADR 0072 decision 2, rulings 1, 3,
 * 4). Assertions live here; `sustainability-rollup.integration.test.ts` owns the fixture. One
 * exported function per claim; each drives `resolveForDashboard` and reads ONE binding.
 */

/** What the fixture hands every claim: the ids it built and the service under test. */
export type RollupFixture = {
  readonly service: MetricCatalogService;
  readonly orgId: string;
  readonly currency: string;
  readonly l1Code: string;
  readonly l2Code: string;
  readonly assetA: string;
  /** A, B, C, D — passed as the caller's readable set on every org-wide read, so the numbers
   * are the fixture's own and no seeded or parallel-suite asset carrying `kl_today` moves them
   * (the `metric-catalog.integration.test.ts` precedent). */
  readonly fixtureAssets: readonly string[];
  readonly l1DashboardId: string;
  readonly l1SumSourceId: string;
  readonly l1AvgSourceId: string;
  readonly wideTableDashboardId: string;
  readonly wideTableSourceId: string;
  /** An org-wide `{ kl_today, sum }` tile beside the table, on the same dashboard. */
  readonly wideTotalSourceId: string;
  readonly wideKwhDashboardId: string;
  readonly wideKwhSourceId: string;
  readonly wideMoneyDashboardId: string;
  readonly wideMoneySourceId: string;
  /** A `{ water_cost_today, sum }` by_location table on the money dashboard: no template carries it. */
  readonly wideMoneyTableSourceId: string;
  readonly wideMoneyAlarmsSourceId: string;
  /** A `{ pf, avg }` tile on the money dashboard: unit `""` like money, and NOT money. */
  readonly widePfSourceId: string;
  readonly nopeSourceId: string;
  /** A dashboard scoped to asset A alone (F3.2 asset scope), one `{ kl_today, sum }` tile. */
  readonly assetScopedDashboardId: string;
  readonly assetScopedSourceId: string;
  /** `E4.3` — an L1 dashboard, one `{ kl_today, sum, balanceRole: "intake" }` tile. */
  readonly roleL1DashboardId: string;
  readonly roleL1IntakeSourceId: string;
  /** `E4.3` — an org-wide dashboard, two by_location tables: `intake` and `discharge`. */
  readonly roleTableDashboardId: string;
  readonly roleTableIntakeSourceId: string;
  readonly roleTableDischargeSourceId: string;
};

const valueOf = (
  response: DashboardCatalogValuesResponse,
  sourceId: string,
): MetricCatalogValueDto => {
  const hit = response.values.find((value) => value.sourceId === sourceId);
  if (hit === undefined) throw new Error(`binding ${sourceId} is absent from values`);
  return hit.resolved;
};

const metricOf = (response: DashboardCatalogValuesResponse, sourceId: string) => {
  const resolved = valueOf(response, sourceId);
  if (resolved.shape !== "metric") throw new Error(`binding ${sourceId} is not a metric`);
  return resolved;
};

const resolveWide = (f: RollupFixture, dashboardId: string) =>
  f.service.resolveForDashboard(f.orgId, dashboardId, [...f.fixtureAssets]);

/** L1-scoped `{ kl_today, sum }` = A 10 + B 20, both fresh: 30 with coverage 2/2. */
export async function l1SumIsThirtyWithFullCoverage(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.l1DashboardId), f.l1SumSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 30,
    coverage: { fresh: 2, carrying: 2 },
  });
}

/**
 * The distinct-params proof: the `sum` and `avg` tiles on the SAME dashboard, read from ONE
 * response, are 30 and 15 — two resolves, not one. Asserted as a pair on purpose: keyed on the
 * catalog key alone, whichever binding is visited last wins for both, and a single-tile claim
 * stays green half the time.
 */
export async function l1AvgOnTheSameDashboardIsFifteen(f: RollupFixture): Promise<void> {
  const response = await resolveWide(f, f.l1DashboardId);
  expect([
    metricOf(response, f.l1SumSourceId).value,
    metricOf(response, f.l1AvgSourceId).value,
  ]).toEqual([30, 15]);
}

/**
 * The inactive asset E at L1 (on the template, fresh `kl_today` = 40, in the caller's readable
 * set) is neither a denominator nor a term on the L1 dashboard (sweep): 30 with 2/2, not 70
 * with 3/3. The location arm of `resolveAssetScope` hands E's id over; the carrying query is
 * what drops it. The claim reads the `avg` tile so it is not the `sum` claim restated: 15,
 * where E counted would give 23.33….
 */
export async function inactiveAssetIsNotCarrying(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.l1DashboardId), f.l1AvgSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 15,
    coverage: { fresh: 2, carrying: 2 },
  });
}

/** Organization-wide `{ kl_today, sum }`: C's sample is 10 min old against a 180 s bound — 30, 2/3. */
export async function wideSumExcludesTheStaleAssetButCountsIt(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.wideTableDashboardId), f.wideTotalSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 30,
    coverage: { fresh: 2, carrying: 3 },
  });
}

/** `kwh_today` is measured: A at 14 min is fresh, B at 16 min is not, C has no sample — 5 with 1/3
 * (pins the 15-minute constant; the plan wrote 1/2, but C is on the template and carries it too). */
export async function measuredPointUsesTheFifteenMinuteBound(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.wideKwhDashboardId), f.wideKwhSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 5,
    coverage: { fresh: 1, carrying: 3 },
  });
}

/** by_location rows: L1 `{30, "2/2"}`, L2 `{null, "0/1"}`, in code order. */
export async function byLocationListsL1ThenL2WithStringCoverage(f: RollupFixture): Promise<void> {
  const table = valueOf(await resolveWide(f, f.wideTableDashboardId), f.wideTableSourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  const rows = table.rows.filter((row) => row.locationCode === f.l1Code || row.locationCode === f.l2Code);
  expect(rows.map((row) => [row.locationCode, row.value, row.coverage])).toEqual([
    [f.l1Code, 30, "2/2"],
    [f.l2Code, null, "0/1"],
  ]);
}

/** A location with an asset in scope and no carrying asset is present as `null` / `"0/0"`. */
export async function byLocationShowsASiteWithNoMetersAsZeroOverZero(f: RollupFixture): Promise<void> {
  const table = valueOf(await resolveWide(f, f.wideMoneyDashboardId), f.wideMoneyTableSourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  const l2 = table.rows.find((row) => row.locationCode === f.l2Code);
  expect(l2 && { value: l2.value, coverage: l2.coverage }).toEqual({ value: null, coverage: "0/0" });
}

/** The money tile (`water_cost_today`, unit `""`) carries the organization's currency. */
export async function moneyTileCarriesTheOrganizationCurrency(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.wideMoneyDashboardId), f.wideMoneySourceId);
  expect(tile.currency).toBe(f.currency);
}

/** The `kl_today` tile (unit `KL`) carries `currency: null`. */
export async function quantityTileCarriesNoCurrency(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.l1DashboardId), f.l1SumSourceId);
  expect(tile.currency).toBeNull();
}

/**
 * The `pf` tile carries `currency: null` (sweep, owner ruling 2026-09-22): `""` is the shared
 * no-unit spelling of 247 codes, and only a listed money code takes the currency. The
 * `water_cost_today` claim above is this claim's positive control.
 */
export async function noUnitNonMoneyTileCarriesNoCurrency(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.wideMoneyDashboardId), f.widePfSourceId);
  expect(tile.currency).toBeNull();
}

/** A hand-inserted binding whose params fail the write schema is absent, and nothing throws. */
export async function unparseableBindingIsSkippedNotThrown(f: RollupFixture): Promise<void> {
  const response = await resolveWide(f, f.wideMoneyDashboardId);
  expect(response.values.map((value) => value.sourceId)).not.toContain(f.nopeSourceId);
  // Positive control on the same call: the well-formed money tile on that dashboard resolved.
  expect(response.values.map((value) => value.sourceId)).toContain(f.wideMoneySourceId);
}

/** `alarms.active.count` on the same dashboard emits neither `coverage` nor `currency`. */
export async function olderMetricEmitsNoCoverageOrCurrency(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.wideMoneyDashboardId), f.wideMoneyAlarmsSourceId);
  expect("coverage" in tile || "currency" in tile).toBe(false);
}

/** Caller scope ∩: reading the org-wide table as a caller who can read only A gives L1 `{10, "1/1"}` and no L2. */
export async function callerScopeIntersectsTheTable(f: RollupFixture): Promise<void> {
  const response = await f.service.resolveForDashboard(f.orgId, f.wideTableDashboardId, [f.assetA]);
  const table = valueOf(response, f.wideTableSourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  const rows = table.rows.filter((row) => row.locationCode === f.l1Code || row.locationCode === f.l2Code);
  expect(rows.map((row) => [row.locationCode, row.value, row.coverage])).toEqual([[f.l1Code, 10, "1/1"]]);
}

/** An asset-scoped dashboard on A rolls up A alone: 10 with 1/1 (ADR 0072 ruling 3, review). */
export async function assetScopedDashboardRollsUpItsOneAsset(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.assetScopedDashboardId), f.assetScopedSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 10,
    coverage: { fresh: 1, carrying: 1 },
  });
}

/** Two locations are under the cap: `truncated` is false (the control for the pure cap claim). */
export async function byLocationUnderTheCapIsNotTruncated(f: RollupFixture): Promise<void> {
  const table = valueOf(await resolveWide(f, f.wideTableDashboardId), f.wideTableSourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  expect(table.truncated).toBe(false);
}

/** What the 201-location fixture hands its one claim. */
export type CapFixture = {
  readonly service: MetricCatalogService;
  readonly orgId: string;
  readonly dashboardId: string;
  readonly sourceId: string;
  /** The 201 template-less assets, one per location — the caller's readable set. */
  readonly assetIds: readonly string[];
};

/**
 * 201 locations in scope, each owning one asset that carries nothing: the table returns
 * exactly `MAX_DATASET_ROWS` rows and `truncated: true`. This is the claim the mutations
 * `capped.truncated -> false` and "remove the `+ 1` limit" must redden; the two-location
 * control above stays green under both.
 */
export async function byLocationOverTheCapIsTruncated(f: CapFixture): Promise<void> {
  const response = await f.service.resolveForDashboard(f.orgId, f.dashboardId, [...f.assetIds]);
  const table = valueOf(response, f.sourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  expect({ rows: table.rows.length, truncated: table.truncated }).toEqual({
    rows: MAX_DATASET_ROWS,
    truncated: true,
  });
}

// ---------------------------------------------------------------------------
// `E4.3` U4 / ADR 0073 decision 2 — `balanceRole` narrows the carrying set, and with it the
// coverage. A = `intake`, B = `internal`, C = `NULL`. One claim per function.
// ---------------------------------------------------------------------------

/**
 * L1 `{ kl_today, sum, balanceRole: "intake" }` = A alone: 10 with 1/1. The unfiltered tile on
 * the L1 dashboard reads 30 with 2/2 from the same rows (`l1SumIsThirtyWithFullCoverage`) — the
 * double count this parameter exists to remove, held in both directions by one fixture.
 */
export async function intakeTileAtL1IsTenWithOneOfOne(f: RollupFixture): Promise<void> {
  const tile = metricOf(await resolveWide(f, f.roleL1DashboardId), f.roleL1IntakeSourceId);
  expect({ value: tile.value, coverage: tile.coverage }).toEqual({
    value: 10,
    coverage: { fresh: 1, carrying: 1 },
  });
}

const roleTableRow = async (f: RollupFixture, sourceId: string, locationCode: string) => {
  const table = valueOf(await resolveWide(f, f.roleTableDashboardId), sourceId);
  if (table.shape !== "dataset") throw new Error("by_location must resolve to a dataset");
  const row = table.rows.find((candidate) => candidate.locationCode === locationCode);
  return row === undefined ? undefined : { value: row.value, coverage: row.coverage };
};

/** The org-wide intake table's L1 row: A alone, 10 with `"1/1"`. */
export async function intakeTableGivesL1TenOverOneOfOne(f: RollupFixture): Promise<void> {
  expect(await roleTableRow(f, f.roleTableIntakeSourceId, f.l1Code)).toEqual({
    value: 10,
    coverage: "1/1",
  });
}

/**
 * L2 is still a row under the role filter: `null` / `"0/0"`. The row set is "locations owning
 * an asset in scope" (E4.2 OQ7) and the role filters the carrying set only — a filter on the
 * location query would drop L2, whose one asset C has no role.
 */
export async function intakeTableKeepsL2AsARowAtZeroOverZero(f: RollupFixture): Promise<void> {
  expect(await roleTableRow(f, f.roleTableIntakeSourceId, f.l2Code)).toEqual({
    value: null,
    coverage: "0/0",
  });
}

/** `discharge` — no fixture asset carries it — answers L1 `null` / `"0/0"`, not the unfiltered 30. */
export async function dischargeTableGivesL1NullOverZeroOfZero(f: RollupFixture): Promise<void> {
  expect(await roleTableRow(f, f.roleTableDischargeSourceId, f.l1Code)).toEqual({
    value: null,
    coverage: "0/0",
  });
}

// ---------------------------------------------------------------------------
// `E4.3` U9 / ADR 0073 decision 3 — `water.balance`. L1: W intake (`kl_today` 50), S reuse
// (`outlet_kl_today` 11), E discharge (`outlet_kl_today` 7), R internal (`outlet_kl_today` 5,
// in no column). L2: N with a `NULL` role. L3: I intake (`kl_today` 20) and D discharge
// (`outlet_kl_today` stale at now − 10 min). One claim per function.
// ---------------------------------------------------------------------------

/** What the balance fixture hands every claim. */
export type BalanceFixture = {
  readonly service: MetricCatalogService;
  readonly orgId: string;
  readonly l1Code: string;
  readonly l2Code: string;
  readonly l3Code: string;
  readonly assetW: string;
  /** Every fixture asset — the caller's readable set on each org-wide read. */
  readonly fixtureAssets: readonly string[];
  /** An org-wide dashboard: `water.balance { today }`, `water.balance { this_month }`, and a
   * `sustainability.by_location { kl_today, sum }` table beside them (the L2 positive control). */
  readonly dashboardId: string;
  readonly todaySourceId: string;
  readonly thisMonthSourceId: string;
  readonly byLocationSourceId: string;
};

type BalanceCell = string | number | boolean | null;

const balanceRows = async (
  f: BalanceFixture,
  sourceId: string,
  readable: readonly string[] = f.fixtureAssets,
): Promise<Record<string, BalanceCell>[]> => {
  const response = await f.service.resolveForDashboard(f.orgId, f.dashboardId, [...readable]);
  const table = valueOf(response, sourceId);
  if (table.shape !== "dataset") throw new Error(`binding ${sourceId} is not a dataset`);
  return table.rows;
};

const balanceRow = async (f: BalanceFixture, locationCode: string) =>
  (await balanceRows(f, f.todaySourceId)).find((row) => row.locationCode === locationCode);

const fiveOf = (row: Record<string, BalanceCell> | undefined) =>
  row && [row.intake, row.reuse, row.discharge, row.consumed, row.coverage];

/**
 * The balance rows are exactly `[L1, L3]`, in code order: L2's one asset has no role, so L2
 * is no row — the row set is the locations owning a ROLED asset in scope. An exact list, not
 * a "does not contain", so an empty table cannot pass it.
 */
export async function balanceRowsAreL1ThenL3WithoutL2(f: BalanceFixture): Promise<void> {
  const rows = await balanceRows(f, f.todaySourceId);
  expect(rows.map((row) => row.locationCode)).toEqual([f.l1Code, f.l3Code]);
}

/** The positive control for the claim above: L2 IS in scope — the `by_location` table on the
 * same dashboard lists it (E4.2 OQ7 is untouched by the balance). */
export async function byLocationBesideTheBalanceStillListsL2(f: BalanceFixture): Promise<void> {
  const rows = await balanceRows(f, f.byLocationSourceId);
  expect(rows.map((row) => row.locationCode)).toEqual([f.l1Code, f.l2Code, f.l3Code]);
}

/** L1 intake reads `kl_today` over W alone: 50. */
export async function l1IntakeIsFifty(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l1Code))?.intake).toBe(50);
}

/** L1 reuse reads `outlet_kl_today` over S alone: 11 (R's internal 5 is no term). */
export async function l1ReuseIsEleven(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l1Code))?.reuse).toBe(11);
}

/** L1 discharge reads `outlet_kl_today` over E alone: 7 (R's internal 5 is no term). */
export async function l1DischargeIsSeven(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l1Code))?.discharge).toBe(7);
}

/** L1 consumed = 50 − 7 = 43; reuse is NOT added (ADR 0073 decision 3, Q7) — not 54. */
export async function l1ConsumedIsFortyThree(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l1Code))?.consumed).toBe(43);
}

/** L1 coverage counts W, S and E: `"3/3"` — R (internal) feeds no column and no count (Q9). */
export async function l1CoverageIsThreeOfThree(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l1Code))?.coverage).toBe("3/3");
}

/** L3's only discharge asset is stale: consumed `null`, never `20 − 0` (Q8). */
export async function l3ConsumedIsNullWithAStaleDischarge(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l3Code))?.consumed).toBeNull();
}

/** L3 coverage: I fresh, D carrying and stale — `"1/2"`. */
export async function l3CoverageIsOneOfTwo(f: BalanceFixture): Promise<void> {
  expect((await balanceRow(f, f.l3Code))?.coverage).toBe("1/2");
}

/**
 * `{ period: "this_month" }` — the fixture template has no `kl_this_month` or
 * `outlet_kl_this_month` row, so nothing carries; L1 is still a row, all `null` at `"0/0"`.
 * The row rule is role-based, not sample-based.
 */
export async function thisMonthKeepsL1AsANullRow(f: BalanceFixture): Promise<void> {
  const rows = await balanceRows(f, f.thisMonthSourceId);
  expect(fiveOf(rows.find((row) => row.locationCode === f.l1Code))).toEqual([
    null,
    null,
    null,
    null,
    "0/0",
  ]);
}

/**
 * Caller scope ∩: a caller who can read only W gets one row, L1 `{50, null, null, 50, "1/1"}`
 * — no discharge asset carries in that scope, so consumed is `intake − 0` (Q8).
 */
export async function callerScopeOfWAloneIsOneRow(f: BalanceFixture): Promise<void> {
  const rows = await balanceRows(f, f.todaySourceId, [f.assetW]);
  expect(rows.map((row) => [row.locationCode, ...(fiveOf(row) ?? [])])).toEqual([
    [f.l1Code, 50, null, null, 50, "1/1"],
  ]);
}
