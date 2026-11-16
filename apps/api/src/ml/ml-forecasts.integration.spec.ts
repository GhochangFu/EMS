import { sql } from "drizzle-orm";
import { forecastListRowSchema, pointForecastResponseSchema, resolveSiteTimeZone } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import { expect } from "vitest";

import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { withRollback } from "../testing/with-rollback";
import { HOUR_MS } from "./ml-forecasts.pure";
import { forecastListStatement, pointForecastStatement, readForecastList } from "./ml-forecasts.reads";
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
  runs: { a: string; failed: string; past: string; future: string; l2: string; p1: string; l3: string };
  /** What each fixture asset's row should carry (read on the superuser connection). */
  expected: Record<
    "l1" | "l2" | "p1" | "l3",
    { code: string; name: string; rtuName: string | null; locationId: string; locationName: string; timeZone: string }
  >;
  /** Organization A's own zone, which L3's zone-less site must fall back to. */
  organizationAZone: string;
  /** The superuser pool, for the one rolled-back case that plants bulk rows and runs `ANALYZE`. */
  superuserDb: BmsDb;
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

/** For the wrapper: what a row's zone should be, by the history page's chain (C7). */
export const zoneOf = (locationZone: string | null, organizationZone: string | null): string =>
  resolveSiteTimeZone(locationZone, organizationZone).timeZone;
