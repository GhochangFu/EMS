import { sql } from "drizzle-orm";

import { MAX_DATASET_ROWS, MONEY_POINT_KEY_CODES } from "@bms/shared";
import type { RollupCoverage, SustainabilityAggregate } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `E4.2` U4 — the sustainability roll-up: one point key summed or averaged across the assets in
 * a dashboard's scope that carry it (ADR 0072 decision 2). The `energy-cost.ts` shape: a pure
 * half with a unit test, and a database half that reads the rows the pure half reduces.
 *
 * ## Freshness (ADR 0072 ruling 1)
 *
 * An asset contributes only when its latest sample of `pointKey` is younger than the point's
 * freshness bound; otherwise it is excluded from the value and counted in `coverage.carrying`.
 * For a **scheduled derived** point the bound is three times its effective
 * `calc_interval_seconds` — `COALESCE(asset_points.calc_interval_seconds,
 * template_points.calc_interval_seconds)`, ADR 0039 decisions 6–7. A **measured** point has no
 * interval to read (`bms.rtus` records no poll cadence, and the SPA's 25 s live indicator is
 * too tight for a daily total from an RTU polling every few minutes), so its bound is the flat
 * `MEASURED_ROLLUP_FRESH_MS`. It is a constant rather than a column so that a later RTU cadence
 * column can replace it in one place.
 *
 * ## Two statements, not one, and why
 *
 * `readRollupRows` first reads the CARRYING assets with their effective interval (no telemetry
 * touched), computes each bound through `freshnessBoundSeconds` — the ONE declaration of the
 * rule, the same one the unit test pins — and then reads the latest fresh sample per asset
 * with the `unnest … CROSS JOIN LATERAL` idiom `CalcInputsService.getLatestSamplesForPairs`
 * measured (10.1 ms against 14.3 s for `DISTINCT ON` over a pair set; do not "simplify" it
 * back). Folding the bound into a SQL `CASE` would be a second declaration of the freshness
 * rule that the test cannot see.
 *
 * ## Currency (ADR 0072 ruling 4, plan OQ1; sweep ruling 2026-09-22)
 *
 * `isMoneyPointKey` decides WHETHER a tile carries a currency: membership in
 * `MONEY_POINT_KEY_CODES`, never the point's unit. PR 1 read `unit === ""` as "money", but
 * `""` is the shared no-unit spelling of 247 codes (`pf`, `pue`, the `*_per_day` counts), so
 * a power factor tile carried the organization's currency. The unit is still read and
 * reported; it just no longer decides.
 *
 * `rollupCurrency` is the `energy-cost.ts` one-currency-else-`null` rule kept as a pure
 * function. On this route `resolveForDashboard` runs inside ONE organization's tenant
 * transaction and `bms.organizations.currency` is `NOT NULL`, so the set always has one member
 * — the mixed case is unreachable here and the function exists so a later multi-organization
 * read inherits the rule rather than re-deriving it.
 */

/** The flat freshness bound for a measured point: fifteen minutes. */
export const MEASURED_ROLLUP_FRESH_MS = 15 * 60 * 1000;

/** What decides a carrying asset's freshness bound — the point's kind and effective cadence. */
export type FreshnessInput = {
  readonly kind: string;
  readonly calcTrigger: string | null;
  readonly calcIntervalSeconds: number | null;
};

/**
 * Seconds a sample stays fresh: `3 × interval` for a scheduled derived point with an interval,
 * else the measured constant. A derived point with no scheduled interval (on-change, or a null
 * interval) has no cadence to multiply, and falls to the same constant rather than to zero —
 * a zero bound would silently exclude every such asset.
 */
export function freshnessBoundSeconds(row: FreshnessInput): number {
  if (
    row.kind === "derived" &&
    row.calcTrigger === "scheduled" &&
    row.calcIntervalSeconds !== null &&
    row.calcIntervalSeconds > 0
  ) {
    return 3 * row.calcIntervalSeconds;
  }
  return MEASURED_ROLLUP_FRESH_MS / 1000;
}

/** One carrying asset's contribution: `value` is `null` when it had no fresh sample. */
export type RollupInput = { readonly value: number | null };

/**
 * The roll-up itself. `carrying = rows.length`, `fresh` = rows with a value, `value = null`
 * when nothing is fresh — never `?? 0`, because a zero here is a fabricated number in front
 * of an operator (the contract's own reason for a nullable `value`).
 */
export function rollup(
  rows: readonly RollupInput[],
  aggregate: SustainabilityAggregate,
): { value: number | null; coverage: RollupCoverage } {
  const fresh = rows.flatMap((row) => (row.value === null ? [] : [row.value]));
  const coverage = { fresh: fresh.length, carrying: rows.length };
  if (fresh.length === 0) return { value: null, coverage };
  const sum = fresh.reduce((acc, value) => acc + value, 0);
  return { value: aggregate === "sum" ? sum : sum / fresh.length, coverage };
}

/** Whether `pointKey` is a listed money code — the one test for attaching a currency. */
export function isMoneyPointKey(pointKey: string): boolean {
  return (MONEY_POINT_KEY_CODES as readonly string[]).includes(pointKey);
}

/** The one currency of the set, else `null`; a `null` member is its own "currency". */
export function rollupCurrency(currencies: ReadonlySet<string | null>): string | null {
  if (currencies.size !== 1) return null;
  const [only] = currencies;
  return only ?? null;
}

/**
 * The dataset cap, as the sibling resolvers apply it: the first `MAX_DATASET_ROWS` rows, and
 * `truncated` is a FACT read off the input's length rather than a guess — the caller reads
 * `MAX_DATASET_ROWS + 1` (or, for `by_location`, groups every location in scope) and this
 * decides. Pure, so the 201-row case is a unit test rather than a 201-location fixture.
 */
export function capRows<T>(rows: readonly T[]): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, MAX_DATASET_ROWS), truncated: rows.length > MAX_DATASET_ROWS };
}

/** One carrying asset in scope, with its latest fresh sample (or none) and its location. */
export type RollupRow = {
  readonly assetId: string;
  readonly assetCode: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  readonly value: number | null;
};

/**
 * The carrying assets of `pointKey` inside `scope`, ordered by location code then asset code,
 * each with its latest sample inside its own freshness bound. An empty `scope` returns `[]`
 * before any SQL.
 *
 * `bms.assets.organization_id = $org` is written even though the tenant policy already holds
 * it: the scope is a list of ids the caller resolved, and the predicate is what keeps this
 * read correct under a role that ignores the policy (`dashboard-source-scope.ts` records the
 * same reasoning).
 *
 * `a.active` is written HERE, whichever arm of `resolveAssetScope` produced the ids (sweep):
 * the organization arm filters `active`, the asset, location and asset-group arms do not, so
 * without it a decommissioned meter still pinned to its template was a permanent denominator
 * — and, while its last sample stayed fresh, a term — on every site dashboard.
 *
 * `balanceRole` (`E4.3`, ADR 0073 decision 2), when given, keeps only the assets whose
 * `water_balance_role` is that code. It narrows the CARRYING set, so the coverage is counted
 * over it too (`carrying` is the row count) — a stale intake meter is `0/1`, never hidden by
 * the fresh treatment stages beside it. Omitted, every carrying asset counts, which on a water
 * plant sums every stage's inlet: the double count the parameter exists to remove.
 */
export async function readRollupRows(
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
  pointKey: string,
  balanceRole?: string,
): Promise<RollupRow[]> {
  if (scope.length === 0) return [];
  const roleFilter =
    balanceRole === undefined ? sql`` : sql`AND a.water_balance_role = ${balanceRole}`;

  // `sql.param` on purpose: a bare JS array inside drizzle's `sql` tag is expanded to a
  // parenthesised list for `IN (...)`, which is not a Postgres array. `param` hands the array
  // to node-postgres whole, which serialises it as one array literal for the cast.
  const carrying = await tx.execute<{
    asset_id: string;
    asset_code: string;
    location_id: string;
    location_code: string;
    location_name: string;
    kind: string;
    calc_trigger: string | null;
    calc_interval_seconds: number | null;
  }>(sql`
    SELECT a.id AS asset_id,
           a.code AS asset_code,
           l.id AS location_id,
           l.code AS location_code,
           l.name AS location_name,
           tp.kind,
           COALESCE(ap.calc_trigger, tp.calc_trigger) AS calc_trigger,
           COALESCE(ap.calc_interval_seconds, tp.calc_interval_seconds) AS calc_interval_seconds
      FROM bms.assets a
      JOIN bms.template_points tp
        ON tp.template_id = a.template_id AND tp.point_key = ${pointKey}
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.asset_points ap
        ON ap.asset_id = a.id AND ap.point_key = ${pointKey}
     WHERE a.id = ANY(${sql.param([...scope])}::uuid[])
       AND a.organization_id = ${organizationId}
       AND a.active
       ${roleFilter}
     ORDER BY l.code, a.code
  `);
  if (carrying.rows.length === 0) return [];

  const assetIds = carrying.rows.map((row) => row.asset_id);
  const bounds = carrying.rows.map((row) =>
    freshnessBoundSeconds({
      kind: row.kind,
      calcTrigger: row.calc_trigger,
      calcIntervalSeconds: row.calc_interval_seconds,
    }),
  );
  const latest = await tx.execute<{ asset_id: string; value: number }>(sql`
    SELECT p.asset_id, s.value
      FROM unnest(${sql.param(assetIds)}::uuid[], ${sql.param(bounds)}::int[]) AS p(asset_id, bound_seconds)
      CROSS JOIN LATERAL (
        SELECT v.value
          FROM telemetry.point_values v
         WHERE v.asset_id = p.asset_id
           AND v.point_key = ${pointKey}
           AND v.time > now() - make_interval(secs => p.bound_seconds)
         ORDER BY v.time DESC
         LIMIT 1
      ) s
  `);
  const valueByAsset = new Map(latest.rows.map((row) => [row.asset_id, Number(row.value)]));

  return carrying.rows.map((row) => ({
    assetId: row.asset_id,
    assetCode: row.asset_code,
    locationId: row.location_id,
    locationCode: row.location_code,
    locationName: row.location_name,
    value: valueByAsset.get(row.asset_id) ?? null,
  }));
}

/**
 * A location that owns at least one `intake`, `reuse` or `discharge` asset in scope — one
 * `water.balance` row — with its count of discharge-roled assets, carrying or not.
 */
export type BalanceLocation = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly dischargeAssets: number;
};

/**
 * `E4.3` U9 (ADR 0073 decision 3) — the `water.balance` ROW set: the locations owning at least
 * one ACTIVE asset in `scope` whose `water_balance_role` is `intake`, `reuse` or `discharge`, in
 * `code` order, reading `MAX_DATASET_ROWS + 1` so `capRows` decides `truncated`. An empty
 * `scope` returns `[]` before any SQL.
 *
 * Unlike `sustainability.by_location` (E4.2 OQ7: every location owning an asset in scope), a
 * site with no asset in a balance column is no row: it has no balance to show, and a row of
 * `null`s there would read as a silent meter. An `internal` asset alone makes no row (the PR 2
 * review's row rule, in line with Q9: `internal` feeds no column). The rule is role-based, not
 * sample-based — a site whose balance-roled assets carry no point for the period is still a
 * row, at `"0/0"`. `a.active` is written for the reason `readRollupRows` gives: a
 * decommissioned roled meter must not hold a site's row open when it can never be a term. The
 * organization predicate is explicit for the same reason as there.
 *
 * `dischargeAssets` counts the same active discharge-roled assets WHATEVER template they are
 * pinned to — the fold compares it with the discharge rows `readRollupRows` returned, so a
 * discharge meter on a pre-v5 template (no `outlet_kl_*` row) makes `consumed` `null` rather
 * than disappearing into `intake − 0` (the PR 2 review ruling on Q8). `::int` because
 * node-postgres returns a `bigint` count as a string.
 */
export async function readBalanceLocations(
  tx: BmsTx,
  organizationId: string,
  scope: readonly string[],
): Promise<BalanceLocation[]> {
  if (scope.length === 0) return [];
  const result = await tx.execute<{
    id: string;
    code: string;
    name: string;
    discharge_assets: number;
  }>(sql`
    SELECT l.id, l.code, l.name,
           (COUNT(*) FILTER (WHERE a.water_balance_role = ${"discharge"}))::int AS discharge_assets
      FROM bms.assets a
      JOIN bms.locations l ON l.id = a.location_id
     WHERE a.id = ANY(${sql.param([...scope])}::uuid[])
       AND a.organization_id = ${organizationId}
       AND a.active
       AND a.water_balance_role IN (${"intake"}, ${"reuse"}, ${"discharge"})
     GROUP BY l.id, l.code, l.name
     ORDER BY l.code
     LIMIT ${MAX_DATASET_ROWS + 1}
  `);
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    dischargeAssets: Number(row.discharge_assets),
  }));
}

/**
 * The point's catalog unit, `null` when the code is unknown. `""` is the NO-UNIT spelling
 * (E4.1c) shared by money, counts and ratios — it does not identify money (`isMoneyPointKey`).
 */
export async function readPointKeyUnit(tx: BmsTx, pointKey: string): Promise<string | null> {
  const result = await tx.execute<{ unit: string | null }>(
    sql`SELECT unit FROM bms.point_keys WHERE code = ${pointKey} LIMIT 1`,
  );
  return result.rows[0]?.unit ?? null;
}

/** The organization's currency (`NOT NULL` since `0076`); `null` only if the row is missing. */
export async function readOrganizationCurrency(
  tx: BmsTx,
  organizationId: string,
): Promise<string | null> {
  const result = await tx.execute<{ currency: string | null }>(
    sql`SELECT currency FROM bms.organizations WHERE id = ${organizationId} LIMIT 1`,
  );
  return result.rows[0]?.currency ?? null;
}
