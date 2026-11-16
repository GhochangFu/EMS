import { sql } from "drizzle-orm";
import {
  forecastListRowSchema,
  pastForecastResponseSchema,
  pointForecastResponseSchema,
  resolveSiteTimeZone,
} from "@bms/shared";
import type { BmsDb } from "@bms/db";
import { expect } from "vitest";

import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { withRollback } from "../testing/with-rollback";
import { HOUR_MS } from "./ml-forecasts.pure";
import {
  forecastListStatement,
  pastForecastStatement,
  pointForecastStatement,
  readForecastList,
  readPastForecast,
} from "./ml-forecasts.reads";
import type { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c, S1, S4, C3, C4, C6, C7 — the forecast
 * reads against a real Postgres, on the real roles: the service reads through
 * `withReadScope` on `bms_tenant` and `bms_fleet`, access control resolves on
 * `bms_auth`. The wrapper (`ml-forecasts.integration.test.ts`) plants every row
 * and removes it by id. Plan §5 T1.9 and §16 B1, B3, security 1 and 2, N3, N12.
 *
 * Fixtures, relative to the current hour H (the injected clock is H + 30 min):
 * - L1 (inside `wc-admin`'s closure, point `e14a_temp`, unit `°C`):
 *   run A, succeeded, buckets H−2 … H+45, issued H−2 h+5 min (the current one);
 *   run F, **failed**, newer, holding rows H−1 … H+46;
 *   run P, succeeded, newest of all, past buckets only (H−30 … H−1, an `--as-of` run);
 *   run U, succeeded, newer than A, first bucket H+1 (B3: not current until then).
 *   Run A's two past buckets carry p50 ±1000, so a min or max over past buckets shows.
 * - L2 (another location of the same organization): one current run.
 * - P1 (the PHEWB organization, a location whose zone differs from the organization's):
 *   one current run whose first bucket is H−4, so it is stale. No asset point, so unit null.
 * - L3 (organization A, a site of its own with no zone, outside `wc-admin`'s closure): one current
 *   run, so its row's zone is the organization's (C7's chain) — read on the tenant branch too.
 */
export type MlForecastFixtures = {
  svc: MlForecastsService;
  tenantDb: BmsDb;
  fleetDb: BmsDb;
  /** The real `readableAssetIds` of each seeded subject. */
  readable: { globalAdmin: string[] | null; locationAdmin: string[] | null };
  now: Date;
  currentHourMs: number;
  assets: { l1: string; l2: string; p1: string; l3: string };
  organizations: { a: string; b: string };
  pointKey: string;
  runs: { a: string; failed: string; past: string; future: string; l2: string; p1: string; l3: string; anomaly: string };
  /** What each fixture asset's row should carry (read on the superuser connection). */
  expected: Record<
    "l1" | "l2" | "p1" | "l3",
    { code: string; name: string; rtuName: string | null; locationId: string; locationName: string; timeZone: string }
  >;
  /** Organization A's own zone, which L3's zone-less site must fall back to. */
  organizationAZone: string;
  /** The superuser pool, for the one rolled-back case that plants bulk rows and runs `ANALYZE`. */
  superuserDb: BmsDb;
  /**
   * `E1.4e`: L4 (organization A, the sibling location, outside `wc-admin`'s closure), whose
   * one-bucket runs plant the past-forecast cases. Kept out of `assets` so the list cases'
   * "exactly these fixture assets" checks do not change. See {@link assertThePastForecastPicksTheOneHourAheadRow}.
   */
  pastAsset: string;
};

const ids = (items: Array<{ assetId: string }>): string[] => items.map((item) => item.assetId);
const mine = (ctx: MlForecastFixtures, items: Array<{ assetId: string }>): string[] =>
  ids(items).filter((id) => Object.values(ctx.assets).includes(id));

/** C3 + R1: the newest succeeded run that holds the current hour wins. */
export async function assertTheNewestSucceededCurrentRunWins(ctx: MlForecastFixtures): Promise<void> {
  const body = pointForecastResponseSchema.parse(
    await ctx.svc.current({ assetId: ctx.assets.l1, pointKey: ctx.pointKey }, ctx.now),
  );
  expect(body.asOf).toBe(ctx.now.toISOString());
  const forecast = body.forecast;
  expect(forecast, "run A must be current").not.toBeNull();
  // Run A was issued at H−2 h + 5 min. F (failed), P (past only) and U (first bucket H+1) are newer.
  expect(forecast?.issuedAt).toBe(new Date(ctx.currentHourMs - 2 * HOUR_MS + 5 * 60_000).toISOString());
  expect(forecast?.modelName).toBe("amazon/chronos-2");
  // C4: buckets from the current hour, all 46 of run A's future ones, ascending.
  expect(forecast?.buckets).toHaveLength(46);
  expect(forecast?.buckets[0]?.t).toBe(new Date(ctx.currentHourMs).toISOString());
  expect(forecast?.buckets[0]?.p50).toBe(11);
  expect(forecast?.buckets.at(-1)?.t).toBe(new Date(ctx.currentHourMs + 45 * HOUR_MS).toISOString());
  // First bucket H−2: 2 h ≤ 3 h.
  expect(forecast?.stale).toBe(false);
}

/**
 * C3 on the one-point read: the first row is the run's first bucket, so a run that scored 4 h ago is
 * stale, while its buckets still start at the current hour (C4). The plan's SQL read the run's rows
 * from the current hour, so its first row was always the current hour and this was never true.
 */
export async function assertTheOnePointReadMarksAStaleRun(ctx: MlForecastFixtures): Promise<void> {
  const body = await ctx.svc.current({ assetId: ctx.assets.p1, pointKey: ctx.pointKey }, ctx.now);
  expect(body.forecast?.stale).toBe(true);
  expect(body.forecast?.issuedAt).toBe(new Date(ctx.currentHourMs - 4 * HOUR_MS + 5 * 60_000).toISOString());
  expect(body.forecast?.buckets[0]?.t).toBe(new Date(ctx.currentHourMs).toISOString());
  expect(body.forecast?.buckets).toHaveLength(44);
}

/** B3: the list agrees with the one-point read about which run is current. */
export async function assertTheListPicksTheSameRun(ctx: MlForecastFixtures): Promise<void> {
  const body = await ctx.svc.list(ctx.readable.globalAdmin, ctx.now);
  const rows = body.items.filter((item) => item.assetId === ctx.assets.l1);
  expect(rows, "one row per point").toHaveLength(1);
  expect(rows[0]?.issuedAt).toBe(new Date(ctx.currentHourMs - 2 * HOUR_MS + 5 * 60_000).toISOString());
}

/** S1, service level, real access control: the location admin sees L1 only; the global admin sees all three. */
export async function assertTheServiceAppliesTheCallersScope(ctx: MlForecastFixtures): Promise<void> {
  const scoped = await ctx.svc.list(ctx.readable.locationAdmin, ctx.now);
  expect(mine(ctx, scoped.items)).toEqual([ctx.assets.l1]);

  // N12: the database may hold real scorer rows, so the fixtures are present, not the whole list.
  const all = await ctx.svc.list(ctx.readable.globalAdmin, ctx.now);
  expect(ids(all.items)).toEqual(expect.arrayContaining([ctx.assets.l1, ctx.assets.l2, ctx.assets.p1]));
}

/** §16 security 1: a two-organization id list takes the fleet branch, and the service still filters by it. */
export async function assertTheServiceFiltersTheFleetBranch(ctx: MlForecastFixtures): Promise<void> {
  const body = await ctx.svc.list([ctx.assets.l1, ctx.assets.p1], ctx.now);
  expect(ids(body.items).sort()).toEqual([ctx.assets.l1, ctx.assets.p1].sort());
}

/** S1, read level: on the fleet branch the ANY filter is the only control. */
export async function assertTheReadFiltersOnTheFleetBranch(ctx: MlForecastFixtures): Promise<void> {
  const rows = await ctx.fleetDb.transaction((tx) =>
    readForecastList(tx, [ctx.assets.l1, ctx.assets.p1], ctx.currentHourMs),
  );
  expect(rows.map((row) => row.asset_id).sort()).toEqual([ctx.assets.l1, ctx.assets.p1].sort());
}

/** The tenant branch: the policy removes P1 through the API's own pool role, whatever the ids say. */
export async function assertThePolicyScopesTheTenantBranch(ctx: MlForecastFixtures): Promise<void> {
  const rows = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) =>
    readForecastList(tx, [ctx.assets.l1, ctx.assets.p1], ctx.currentHourMs),
  );
  expect(rows.map((row) => row.asset_id)).toEqual([ctx.assets.l1]);
}

/** List fields: the p50 summary covers future buckets only; zone, unit and names resolve; the keys are the contract's. */
export async function assertTheListFields(ctx: MlForecastFixtures): Promise<void> {
  const body = await ctx.svc.list(ctx.readable.globalAdmin, ctx.now);
  const byAsset = new Map(body.items.map((item) => [item.assetId, item]));
  const l1 = byAsset.get(ctx.assets.l1);
  const p1 = byAsset.get(ctx.assets.p1);

  // Run A's future p50s are 11 … 33.5 (index i = 2 … 47 at 10 + 0.5 i); its two past ones are ±1000.
  expect(l1).toMatchObject({
    pointKey: ctx.pointKey,
    unit: "°C",
    stale: false,
    p50Min: 11,
    p50Max: 33.5,
    p50PeakAt: new Date(ctx.currentHourMs + 45 * HOUR_MS).toISOString(),
    assetCode: ctx.expected.l1.code,
    assetName: ctx.expected.l1.name,
    assetRtuName: ctx.expected.l1.rtuName,
    locationId: ctx.expected.l1.locationId,
    assetLocationName: ctx.expected.l1.locationName,
    timeZone: ctx.expected.l1.timeZone,
  });
  // B1: P1's location zone differs from its organization's, and its asset name from its location's.
  expect(ctx.expected.p1.name).not.toBe(ctx.expected.p1.locationName);
  expect(p1).toMatchObject({
    unit: null,
    stale: true,
    assetName: ctx.expected.p1.name,
    assetRtuName: ctx.expected.p1.rtuName,
    assetLocationName: ctx.expected.p1.locationName,
    timeZone: ctx.expected.p1.timeZone,
  });
  for (const row of [l1, p1]) {
    expect(Object.keys(row ?? {}).sort()).toEqual(Object.keys(forecastListRowSchema.shape).sort());
  }
}

/**
 * The tenant branch resolves the zone too. L1's site carries its own zone; L3's carries none, so
 * its row takes the organization's — which proves `bms_tenant` under the GUC reads its own
 * `bms.organizations` row (plan §2 verify-at-build). Were that row hidden, L3 would read `UTC`.
 */
export async function assertTheTenantBranchResolvesTheZone(ctx: MlForecastFixtures): Promise<void> {
  const scoped = await ctx.svc.list(ctx.readable.locationAdmin, ctx.now);
  const l1 = scoped.items.find((item) => item.assetId === ctx.assets.l1);
  expect(l1?.timeZone).toBe(ctx.expected.l1.timeZone);
  expect(l1?.assetLocationName).toBe(ctx.expected.l1.locationName);
  expect(l1?.assetRtuName, "bms_tenant reads the asset's RTU under its GUC (ADR 0111)").toBe(ctx.expected.l1.rtuName);

  expect(ctx.organizationAZone, "the fallback must differ from the chain's own default").not.toBe("UTC");
  expect(ctx.expected.l3.timeZone).toBe(ctx.organizationAZone);
  const tenantRows = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) =>
    readForecastList(tx, [ctx.assets.l3], ctx.currentHourMs),
  );
  expect(tenantRows).toHaveLength(1);
  expect(tenantRows[0]?.location_time_zone).toBeNull();
  expect(tenantRows[0]?.organization_time_zone).toBe(ctx.organizationAZone);
  const all = await ctx.svc.list(ctx.readable.globalAdmin, ctx.now);
  expect(all.items.find((item) => item.assetId === ctx.assets.l3)?.timeZone).toBe(ctx.organizationAZone);
}

/** A point with no forecast, and an asset that no longer exists, are `forecast: null`. */
export async function assertNoForecastIsNull(ctx: MlForecastFixtures, vanishedAssetId: string): Promise<void> {
  for (const point of [
    { assetId: ctx.assets.l1, pointKey: "e14a_no_such_point" },
    { assetId: vanishedAssetId, pointKey: ctx.pointKey },
  ]) {
    const body = await ctx.svc.current(point, ctx.now);
    expect(body, point.pointKey).toEqual({ asOf: ctx.now.toISOString(), forecast: null });
  }
}

type PlanNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
};

type ScanOfForecasts = { type: string; index: string | undefined; cond: string };

/**
 * Every node of an `EXPLAIN (FORMAT JSON)` plan that reads `ml.forecasts`: a
 * scan whose relation is `forecasts`, or a bitmap index scan on one of its
 * indexes (a `Bitmap Index Scan` names the index, not the relation).
 */
const forecastScans = (node: PlanNode): ScanOfForecasts[] => {
  const index = node["Index Name"];
  const here =
    node["Relation Name"] === "forecasts" || (index !== undefined && index.startsWith("forecasts_"))
      ? [{ type: node["Node Type"] ?? "", index, cond: node["Index Cond"] ?? "" }]
      : [];
  return [...here, ...(node.Plans ?? []).flatMap(forecastScans)];
};

/**
 * Why a scan of `ml.forecasts` reads more than its run or its point, or `null`.
 * A `Seq Scan` reads the table. A `forecasts_pkey` scan with no `asset_id` bound
 * walks the whole index — measured at build: without `OFFSET 0` the null-ids list
 * plans `Index Scan using forecasts_pkey` on `horizon_bucket = …` alone, which a
 * "no Seq Scan" check passes. `forecasts_model_run_idx` is bound by its only column.
 */
const unboundedScan = (scan: ScanOfForecasts): string | null => {
  if (scan.type === "Seq Scan") return "a sequential scan";
  if (scan.index === "forecasts_pkey" && !/\basset_id = /.test(scan.cond)) {
    return `forecasts_pkey with no asset_id bound (${scan.cond})`;
  }
  if (scan.index === "forecasts_model_run_idx" && !/\bmodel_run_id = /.test(scan.cond)) {
    return `forecasts_model_run_idx with no model_run_id bound (${scan.cond})`;
  }
  return null;
};

const explain = async (tx: BmsTx, statement: ReturnType<typeof forecastListStatement>): Promise<ScanOfForecasts[]> => {
  const result = await tx.execute<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(
    sql`EXPLAIN (FORMAT JSON) ${statement}`,
  );
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  if (!plan) throw new Error("E1.4a: EXPLAIN returned no plan");
  return forecastScans(plan);
};

/**
 * R4 / C6 / N3: about 140,000 rows (60 days of hourly runs up to the current
 * hour, for two organizations, one point each), `ANALYZE`d inside a rolled-back
 * transaction. Neither read may plan a scan of `ml.forecasts` that is not bound
 * to a run id or an asset id ({@link unboundedScan}), as the fleet role (the
 * superuser here: both bypass row security) or as `bms_tenant` under its GUC.
 *
 * **The runs reach the current hour on purpose**, the scorer's real shape: 64 recent
 * runs per organization are in the window.
 *
 * **A smoke check of the shipped plan, not the `OFFSET 0` mutation gate** (plan §16
 * N3). Without `OFFSET 0`, the flattened join (a full walk of `forecasts_pkey`, or a
 * sequential scan) and the per-run path cost about the same here, so this case went
 * red on that mutation in only 3–5 runs of 6, full-size statistics included. The
 * deterministic gate is the text check in `tests/e1.4a-ml-read-containment.test.ts`.
 */
export async function assertNeitherReadSeqScansForecasts(ctx: MlForecastFixtures): Promise<void> {
  await withRollback(ctx.superuserDb, async (tx) => {
    await tx.execute(sql`
      WITH planted AS (
        SELECT gen_random_uuid() AS id, o.org, o.asset,
               to_timestamp(${ctx.currentHourMs}::float8 / 1000.0) - make_interval(hours => h) + interval '5 minutes' AS started
          FROM (VALUES (${ctx.organizations.a}::uuid, ${ctx.assets.l2}::uuid),
                       (${ctx.organizations.b}::uuid, ${ctx.assets.p1}::uuid)) AS o(org, asset),
               generate_series(1, 60 * 24) AS h
      ), runs AS (
        INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                   started_at, finished_at, rows_written, status)
        SELECT id, org, 'amazon/chronos-2', repeat('0', 40), repeat('a', 64), started, started, 48, 'succeeded'
          FROM planted
        RETURNING id
      )
      INSERT INTO ml.forecasts (organization_id, asset_id, point_key, horizon_bucket, issued_at, p10, p50, p90, model_run_id)
      SELECT p.org, p.asset, 'e14a_bulk', date_trunc('hour', p.started, 'UTC') + make_interval(hours => b),
             p.started, 1, 2, 3, p.id
        FROM planted p JOIN runs r ON r.id = p.id, generate_series(0, 47) AS b
    `);
    const count = await tx.execute<{ n: number }>(sql`SELECT count(*)::float8 AS n FROM ml.forecasts`);
    expect(Number(count.rows[0]?.n)).toBeGreaterThan(130_000);
    // A sample as large as the table (the default target samples 30,000 rows), so the shipped
    // plan is judged on the same statistics every run.
    await tx.execute(sql`SET LOCAL default_statistics_target = 1000`);
    await tx.execute(sql`ANALYZE ml.forecasts`);
    await tx.execute(sql`ANALYZE ml.model_runs`);

    const point = { assetId: ctx.assets.l1, pointKey: ctx.pointKey };
    const reads = [
      ["one point", pointForecastStatement(point, ctx.currentHourMs)],
      ["the list, no ids", forecastListStatement(null, ctx.currentHourMs)],
      ["the list, ids", forecastListStatement([ctx.assets.l1, ctx.assets.l2, ctx.assets.p1], ctx.currentHourMs)],
      // `E1.4e`: a week of one bulk point's past hours, on `forecasts_pkey` bound by the point.
      [
        "the past forecast",
        pastForecastStatement({ assetId: ctx.assets.l2, pointKey: "e14a_bulk" }, ctx.currentHourMs - 168 * HOUR_MS, ctx.currentHourMs),
      ],
    ] as const;
    const asTenant = sql.raw(`SET LOCAL ROLE bms_tenant`);
    for (const role of ["fleet", "tenant"] as const) {
      if (role === "tenant") {
        await tx.execute(sql`SELECT set_config('app.current_organization', ${ctx.organizations.a}, true)`);
        await tx.execute(asTenant);
      }
      for (const [label, statement] of reads) {
        const scans = await explain(tx, statement);
        // Positive control: the walk finds ml.forecasts in the plan at all.
        expect(scans.length, `${role} ${label}: the plan reads ml.forecasts`).toBeGreaterThan(0);
        expect(
          scans.map(unboundedScan).filter((why) => why !== null),
          `${role} ${label}: a scan of ml.forecasts that is not bound to a run or a point`,
        ).toEqual([]);
      }
    }
    tx.rollback();
  });
}

const isoAt = (ms: number): string => new Date(ms).toISOString();

/**
 * `E1.4e` / ADR 0135 Amendment 4 — the 1-hour-ahead rule against real rows. L4's runs, by the
 * hour they forecast (H is the current hour; every run holds one bucket unless said):
 * - H−7: issued 30 min before, p50 9 (only inside a window that reaches back that far);
 * - H−6: issued exactly 3 h before, p50 8 (the cap is inclusive);
 * - H−5: issued 4 h before only, p50 7 (beyond the cap: absent);
 * - H−4: issued 10 min after the hour began only, p50 6 (absent);
 * - H−3: issued 30 min (p50 1), 2 h 30 min (2) and 4 h (3) before, 10 min after (4), and 10 min
 *   before by a **failed** run (5) — the 30-minute one wins;
 * - H−2: nothing (absent);
 * - H−1: issued 55 min before, p50 10 (the hourly scorer's normal case);
 * - H and H+1: one run issued 55 min before H, p50 11 — the live forecast's, never returned.
 */
export async function assertThePastForecastPicksTheOneHourAheadRow(ctx: MlForecastFixtures): Promise<void> {
  const H = ctx.currentHourMs;
  const point = { assetId: ctx.pastAsset, pointKey: ctx.pointKey };
  const body = pastForecastResponseSchema.parse(
    await ctx.svc.past(point, { from: new Date(H - 6 * HOUR_MS + 20 * 60_000), to: new Date(H + 5 * HOUR_MS) }, ctx.now),
  );
  expect(body.asOf).toBe(ctx.now.toISOString());
  // `from` floored to H−6 (so H−7 is out); `to` clipped to the current hour (so H and H+1 are out).
  expect(body.buckets).toEqual([
    { t: isoAt(H - 6 * HOUR_MS), p50: 8 },
    { t: isoAt(H - 3 * HOUR_MS), p50: 1 },
    { t: isoAt(H - HOUR_MS), p50: 10 },
  ]);
}

/** `E1.4e`: the window's bounds — `from` floored and inclusive, `to` exclusive, a future window reads nothing. */
export async function assertThePastForecastWindowBoundsHold(ctx: MlForecastFixtures): Promise<void> {
  const H = ctx.currentHourMs;
  const point = { assetId: ctx.pastAsset, pointKey: ctx.pointKey };
  const past = async (fromMs: number, toMs: number) =>
    (await ctx.svc.past(point, { from: new Date(fromMs), to: new Date(toMs) }, ctx.now)).buckets;

  // `to` exactly H−3: the bucket H−3 is excluded (`horizon_bucket < to`).
  expect(await past(H - 8 * HOUR_MS, H - 3 * HOUR_MS)).toEqual([
    { t: isoAt(H - 7 * HOUR_MS), p50: 9 },
    { t: isoAt(H - 6 * HOUR_MS), p50: 8 },
  ]);
  // One minute later it is in.
  expect((await past(H - 3 * HOUR_MS, H - 3 * HOUR_MS + 60_000)).map((b) => b.p50)).toEqual([1]);
  // `to` exactly the current hour, and a window wholly at or after it.
  expect((await past(H - 2 * HOUR_MS, H)).map((b) => b.t)).toEqual([isoAt(H - HOUR_MS)]);
  expect(await past(H, H + 10 * HOUR_MS)).toEqual([]);
  expect(await past(H + 60_000, H + 10 * HOUR_MS)).toEqual([]);
}

/**
 * `E1.4e` on the original fixtures: L1's run A (issued H−2 h + 5 min) is the 1-hour-ahead forecast for
 * H−1 only — its H−2 bucket was issued after that hour began — and run P (an `--as-of` run issued after
 * every bucket it holds) and the failed run F contribute nothing.
 */
export async function assertThePastForecastIgnoresRowsIssuedAfterTheirHour(ctx: MlForecastFixtures): Promise<void> {
  const H = ctx.currentHourMs;
  const body = await ctx.svc.past(
    { assetId: ctx.assets.l1, pointKey: ctx.pointKey },
    { from: new Date(H - 40 * HOUR_MS), to: new Date(H + HOUR_MS) },
    ctx.now,
  );
  expect(body.buckets).toEqual([{ t: isoAt(H - HOUR_MS), p50: -1000 }]);
}

/**
 * `E1.4e`, both branches. P1 (organization B) has 1-hour-ahead rows for H−3, H−2 and H−1 (its run was
 * issued H−4 h + 5 min, so H−1's lead is 2 h 55 min). Under organization A's GUC the policy hides them;
 * under B's they are there (the positive control). On the fleet branch the asset equality is the only
 * filter, and L4's read returns L4's rows and nothing of P1's or L1's.
 */
export async function assertThePastForecastIsScopedOnBothBranches(ctx: MlForecastFixtures): Promise<void> {
  const H = ctx.currentHourMs;
  const p1 = { assetId: ctx.assets.p1, pointKey: ctx.pointKey };
  const from = H - 10 * HOUR_MS;
  const underA = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) => readPastForecast(tx, p1, from, H));
  expect(underA).toEqual([]);
  const underB = await withTenant(ctx.tenantDb, ctx.organizations.b, (tx) => readPastForecast(tx, p1, from, H));
  expect(underB.map((row) => [row.bucket_ms, row.p50])).toEqual([
    [H - 3 * HOUR_MS, 30],
    [H - 2 * HOUR_MS, 30],
    [H - HOUR_MS, 30],
  ]);
  // The service routes P1 to its own organization.
  const viaService = await ctx.svc.past(p1, { from: new Date(from), to: new Date(H) }, ctx.now);
  expect(viaService.buckets.map((b) => b.t)).toEqual([3, 2, 1].map((h) => isoAt(H - h * HOUR_MS)));

  const fleetRows = await ctx.fleetDb.transaction((tx) =>
    readPastForecast(tx, { assetId: ctx.pastAsset, pointKey: ctx.pointKey }, from, H),
  );
  expect(fleetRows.map((row) => row.p50)).toEqual([9, 8, 1, 10]);
}

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-a (plan T2.8) — the forecast reads ignore `bms-anomaly` runs.
 * The wrapper plants a succeeded `bms-anomaly` run, newer than every forecast fixture run, started
 * H + 20 min with score rows for L1 (H−1, both detectors). The one-point forecast, the past forecast
 * and the list are what they are without it, and the list has no extra row. The list's
 * `recent_runs` CTE takes the anomaly run (it has no model filter); its lateral finds no forecast.
 */
export async function assertAnAnomalyRunChangesNoForecastRead(ctx: MlForecastFixtures): Promise<void> {
  // Positive control: the anomaly run is there, succeeded, newer than every forecast fixture run, with scores for L1.
  const others = Object.entries(ctx.runs)
    .filter(([name]) => name !== "anomaly")
    .map(([, id]) => id);
  const planted = await ctx.superuserDb.execute<{ newer: boolean; scores: number }>(sql`
    SELECT (SELECT r.status = 'succeeded' AND r.started_at > (SELECT max(o.started_at) FROM ml.model_runs o
                                                               WHERE o.id = ANY(${`{${others.join(",")}}`}::uuid[]))
              FROM ml.model_runs r WHERE r.id = ${ctx.runs.anomaly}::uuid) AS newer,
           (SELECT count(*) FROM ml.anomaly_scores s WHERE s.model_run_id = ${ctx.runs.anomaly}::uuid
               AND s.asset_id = ${ctx.assets.l1}::uuid)::float8 AS scores`);
  expect(planted.rows[0]?.newer).toBe(true);
  expect(Number(planted.rows[0]?.scores)).toBe(2);

  const current = await ctx.svc.current({ assetId: ctx.assets.l1, pointKey: ctx.pointKey }, ctx.now);
  expect(current.forecast?.issuedAt).toBe(new Date(ctx.currentHourMs - 2 * HOUR_MS + 5 * 60_000).toISOString());
  expect(current.forecast?.modelName).toBe("amazon/chronos-2");
  expect(current.forecast?.buckets).toHaveLength(46);

  const past = await ctx.svc.past(
    { assetId: ctx.assets.l1, pointKey: ctx.pointKey },
    { from: new Date(ctx.currentHourMs - 40 * HOUR_MS), to: new Date(ctx.currentHourMs + HOUR_MS) },
    ctx.now,
  );
  expect(past.buckets).toEqual([{ t: isoAt(ctx.currentHourMs - HOUR_MS), p50: -1000 }]);

  for (const readable of [ctx.readable.globalAdmin, Object.values(ctx.assets)]) {
    const list = await ctx.svc.list(readable, ctx.now);
    const fixtureRows = list.items.filter((item) => Object.values(ctx.assets).includes(item.assetId));
    // One row per fixture asset (each has one forecast point), so no row came from the anomaly run.
    expect(fixtureRows.map((item) => item.assetId).sort()).toEqual(Object.values(ctx.assets).sort());
    expect(fixtureRows.every((item) => item.modelName === "amazon/chronos-2")).toBe(true);
  }
}

/** For the wrapper: what a row's zone should be, by the history page's chain (C7). */
export const zoneOf = (locationZone: string | null, organizationZone: string | null): string =>
  resolveSiteTimeZone(locationZone, organizationZone).timeZone;
