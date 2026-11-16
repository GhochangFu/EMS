import { sql } from "drizzle-orm";
import { anomalyListResponseSchema, anomalyListRowSchema, assetAnomaliesResponseSchema } from "@bms/shared";
import type { BmsDb } from "@bms/db";
import { expect } from "vitest";

import { withTenant } from "../database/tenant-context";
import type { BmsTx } from "../database/tenant-context";
import { withRollback } from "../testing/with-rollback";
import { anomalyListStatement, assetAnomaliesStatement, readAnomalyList } from "./ml-anomalies.reads";
import type { MlAnomaliesService } from "./ml-anomalies.service";
import { HOUR_MS } from "./ml-forecasts.pure";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1, S4; plan T2.7, R12, R13)
 * — the anomaly reads against a real Postgres, on the real roles: the service
 * reads through `withReadScope` on `bms_tenant` and `bms_fleet`, access control
 * resolves on `bms_auth`. The wrapper (`ml-anomalies.integration.test.ts`)
 * plants every row as `bms_fleet` and removes it by run id. Synthetic data.
 *
 * Fixtures, relative to the current hour H (the injected clock is H + 30 min).
 * Every run is a `bms-anomaly` run; `bl` is `baseline_mad`, `if` `isolation_forest`:
 * - L1 (inside `wc-admin`'s closure, on an RTU of its own):
 *   run `main`, started H−3 h+5 min: H−4 bl 0.995, H−4 if 0.5, H−5 bl 0.99 (exactly the line),
 *   H−6 bl 0.989999 (just under);
 *   run `failed`, **failed**, newer: H−4 bl 0.1 (never wins);
 *   R12: H−10 bl 0.995 by an older run, 0.5 by a newer one (not listed; the asset read says 0.5);
 *   the reverse: H−12 if 0.5 by an older run, 0.995 by a newer one (listed);
 *   run `ancient`, started 8 days ago: H−8 d−1 h bl 0.999 (outside the 7 days);
 *   run `backfill`, started H−1 h+5 min, holding H−8 d bl 0.999 (a recent run, an old bucket).
 * - L2 (another location of the same organization): H−4 bl 0.995.
 * - P1 (the PHEWB organization, a location whose zone differs from the organization's): H−4 if 0.999.
 */
export type MlAnomalyFixtures = {
  svc: MlAnomaliesService;
  tenantDb: BmsDb;
  fleetDb: BmsDb;
  superuserDb: BmsDb;
  /** The real `readableAssetIds` of each seeded subject. */
  readable: { globalAdmin: string[] | null; locationAdmin: string[] | null };
  now: Date;
  currentHourMs: number;
  assets: { l1: string; l2: string; p1: string };
  organizations: { a: string; b: string };
  /** What each fixture asset's row should carry (read on the superuser connection). */
  expected: Record<
    "l1" | "l2" | "p1",
    { code: string; name: string; rtuName: string | null; locationId: string; locationName: string; timeZone: string }
  >;
};

type Item = { assetId: string; t: string; detector: string; score: number };

const hourIso = (ctx: MlAnomalyFixtures, hours: number): string => new Date(ctx.currentHourMs + hours * HOUR_MS).toISOString();
const mine = <T extends { assetId: string }>(ctx: MlAnomalyFixtures, items: readonly T[]): T[] =>
  items.filter((item) => Object.values(ctx.assets).includes(item.assetId));
const assetsOf = (items: ReadonlyArray<{ assetId: string }>): string[] => [...new Set(items.map((item) => item.assetId))].sort();
const summary = (item: Item): [string, string, number] => [item.t, item.detector, item.score];

/** S1, service level, real access control: wc-admin lists L1 only; the global admin's list contains all three. */
export async function assertTheServiceAppliesTheCallersScope(ctx: MlAnomalyFixtures): Promise<void> {
  const scoped = anomalyListResponseSchema.parse(await ctx.svc.list(ctx.readable.locationAdmin, undefined, ctx.now));
  expect(assetsOf(mine(ctx, scoped.items))).toEqual([ctx.assets.l1]);
  // The database may hold real scorer rows, so the fixtures are present, not the whole list.
  const all = await ctx.svc.list(ctx.readable.globalAdmin, undefined, ctx.now);
  expect(assetsOf(mine(ctx, all.items))).toEqual([ctx.assets.l1, ctx.assets.l2, ctx.assets.p1].sort());
}

/** S1 on the fleet branch: a two-organization id list returns exactly those assets, at the service and the read. */
export async function assertTheFleetBranchFiltersByAsset(ctx: MlAnomalyFixtures): Promise<void> {
  const ids = [ctx.assets.l1, ctx.assets.p1];
  const body = await ctx.svc.list(ids, undefined, ctx.now);
  expect(assetsOf(body.items)).toEqual([...ids].sort());
  const sinceMs = ctx.currentHourMs - 7 * 24 * HOUR_MS;
  const rows = await ctx.fleetDb.transaction((tx) => readAnomalyList(tx, ids, sinceMs));
  expect([...new Set(rows.map((row) => row.asset_id))].sort()).toEqual([...ids].sort());
}

/** The tenant branch: the policy removes P1 through the API's own pool role, whatever the ids say. */
export async function assertThePolicyScopesTheTenantBranch(ctx: MlAnomalyFixtures): Promise<void> {
  const sinceMs = ctx.currentHourMs - 7 * 24 * HOUR_MS;
  const rows = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) =>
    readAnomalyList(tx, [ctx.assets.l1, ctx.assets.p1], sinceMs),
  );
  expect([...new Set(rows.map((row) => row.asset_id))]).toEqual([ctx.assets.l1]);
}

/**
 * The threshold, R12 and the failed run, on L1's list rows, newest first: H−4 bl (0.995; the newer
 * failed run's 0.1 is ignored), H−5 bl (exactly 0.99), H−12 if (the newer run's 0.995). Not H−6
 * (0.989999), not H−4 if (0.5), not H−10 (the newer run's 0.5 wins before the line).
 */
export async function assertTheListAppliesTheLineAfterTheNewestRun(ctx: MlAnomalyFixtures): Promise<void> {
  const body = await ctx.svc.list([ctx.assets.l1], undefined, ctx.now);
  expect(body.items.map(summary)).toEqual([
    [hourIso(ctx, -4), "baseline_mad", 0.995],
    [hourIso(ctx, -5), "baseline_mad", 0.99],
    [hourIso(ctx, -12), "isolation_forest", 0.995],
  ]);
  expect(body.truncated).toBe(false);
  expect(body.items[0]?.contributingPoints).toEqual(["kw", "pf"]);
}

/** R13: a row older than 7 days is not listed, whatever `since` says; `since` is echoed clamped and floored. */
export async function assertTheListNeverReachesPastSevenDays(ctx: MlAnomalyFixtures): Promise<void> {
  const sevenDays = new Date(ctx.currentHourMs - 7 * 24 * HOUR_MS).toISOString();
  for (const since of [undefined, new Date(ctx.currentHourMs - 30 * 24 * HOUR_MS)]) {
    const body = await ctx.svc.list([ctx.assets.l1], since, ctx.now);
    expect(body.since, String(since)).toBe(sevenDays);
    expect(body.items.filter((item) => item.score === 0.999), String(since)).toEqual([]);
  }
  // A `since` inside the window narrows it: from H−5, the H−12 row is gone.
  const narrowed = await ctx.svc.list([ctx.assets.l1], new Date(ctx.currentHourMs - 5 * HOUR_MS + 10 * 60_000), ctx.now);
  expect(narrowed.since).toBe(hourIso(ctx, -5));
  expect(narrowed.items.map((item) => item.t)).toEqual([hourIso(ctx, -4), hourIso(ctx, -5)]);
  // A `since` in a future hour reads nothing.
  const future = await ctx.svc.list([ctx.assets.l1], new Date(ctx.currentHourMs + 2 * HOUR_MS), ctx.now);
  expect(future.items).toEqual([]);
}

/** Newest first across assets; the names and the zone resolve; the row's key set equals the contract's. */
export async function assertTheListRowFields(ctx: MlAnomalyFixtures): Promise<void> {
  const body = anomalyListResponseSchema.parse(await ctx.svc.list(ctx.readable.globalAdmin, undefined, ctx.now));
  const times = body.items.map((item) => Date.parse(item.t));
  expect(times, "newest first").toEqual([...times].sort((a, b) => b - a));
  const l1 = body.items.find((item) => item.assetId === ctx.assets.l1);
  const p1 = body.items.find((item) => item.assetId === ctx.assets.p1);
  expect(l1).toMatchObject({
    assetCode: ctx.expected.l1.code,
    assetName: ctx.expected.l1.name,
    assetRtuName: ctx.expected.l1.rtuName,
    locationId: ctx.expected.l1.locationId,
    assetLocationName: ctx.expected.l1.locationName,
    timeZone: ctx.expected.l1.timeZone,
  });
  // P1's location zone differs from its organization's: the location's wins.
  expect(p1).toMatchObject({
    t: hourIso(ctx, -4),
    detector: "isolation_forest",
    score: 0.999,
    contributingPoints: ["temp"],
    assetRtuName: null,
    assetLocationName: ctx.expected.p1.locationName,
    timeZone: ctx.expected.p1.timeZone,
  });
  for (const row of [l1, p1]) {
    expect(Object.keys(row ?? {}).sort()).toEqual(Object.keys(anomalyListRowSchema.shape).sort());
  }
}

/**
 * The asset read: every score in the window (not only the unusual ones), both detectors of an hour,
 * ascending by hour then detector, the newest succeeded run per hour and detector (R12).
 */
export async function assertTheAssetReadReturnsTheWindowAscending(ctx: MlAnomalyFixtures): Promise<void> {
  const H = ctx.currentHourMs;
  const body = assetAnomaliesResponseSchema.parse(
    await ctx.svc.forAsset(ctx.assets.l1, { from: new Date(H - 12 * HOUR_MS), to: new Date(H - 3 * HOUR_MS) }, ctx.now),
  );
  expect(body.asOf).toBe(ctx.now.toISOString());
  expect(body.scores.map((s) => [s.t, s.detector, s.score])).toEqual([
    [hourIso(ctx, -12), "isolation_forest", 0.995],
    [hourIso(ctx, -10), "baseline_mad", 0.5],
    [hourIso(ctx, -6), "baseline_mad", 0.989999],
    [hourIso(ctx, -5), "baseline_mad", 0.99],
    [hourIso(ctx, -4), "baseline_mad", 0.995],
    [hourIso(ctx, -4), "isolation_forest", 0.5],
  ]);
  // `from` floors to its hour (H−6), `to` is exclusive (H−4 is out).
  const inner = await ctx.svc.forAsset(
    ctx.assets.l1,
    { from: new Date(H - 6 * HOUR_MS + 20 * 60_000), to: new Date(H - 4 * HOUR_MS) },
    ctx.now,
  );
  expect(inner.scores.map((s) => s.t)).toEqual([hourIso(ctx, -6), hourIso(ctx, -5)]);
  // Another asset's scores never appear; an asset that does not exist reads nothing.
  const p1 = await ctx.svc.forAsset(ctx.assets.p1, { from: new Date(H - 12 * HOUR_MS), to: new Date(H) }, ctx.now);
  expect(p1.scores.map((s) => s.detector)).toEqual(["isolation_forest"]);
}

/** The asset read on the tenant branch: the service routes P1 to its own organization, so its row is read. */
export async function assertTheAssetReadRoutesToTheAssetsOrganization(ctx: MlAnomalyFixtures, vanished: string): Promise<void> {
  const H = ctx.currentHourMs;
  const underA = await withTenant(ctx.tenantDb, ctx.organizations.a, (tx) =>
    tx.execute(assetAnomaliesStatement(ctx.assets.p1, H - 12 * HOUR_MS, H)),
  );
  expect(underA.rows, "organization A's GUC hides P1's scores").toEqual([]);
  const none = await ctx.svc.forAsset(vanished, { from: new Date(H - 12 * HOUR_MS), to: new Date(H) }, ctx.now);
  expect(none).toEqual({ asOf: ctx.now.toISOString(), scores: [] });
}

type PlanNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
};

type ScanOfScores = { type: string; index: string | undefined; cond: string };

/** Every node that reads `ml.anomaly_scores`: a scan of the relation, or an index scan on one of its indexes. */
const scoreScans = (node: PlanNode): ScanOfScores[] => {
  const index = node["Index Name"];
  const here =
    node["Relation Name"] === "anomaly_scores" || (index !== undefined && index.startsWith("anomaly_scores_"))
      ? [{ type: node["Node Type"] ?? "", index, cond: node["Index Cond"] ?? "" }]
      : [];
  return [...here, ...(node.Plans ?? []).flatMap(scoreScans)];
};

/** Why a scan of `ml.anomaly_scores` reads more than its run or its asset, or `null`. */
const unboundedScan = (scan: ScanOfScores): string | null => {
  if (scan.type === "Seq Scan" || scan.type === "Parallel Seq Scan") return "a sequential scan";
  if (scan.index === "anomaly_scores_pkey" && !/\basset_id = /.test(scan.cond)) {
    return `anomaly_scores_pkey with no asset_id bound (${scan.cond})`;
  }
  if (scan.index === "anomaly_scores_model_run_idx" && !/\bmodel_run_id = /.test(scan.cond)) {
    return `anomaly_scores_model_run_idx with no model_run_id bound (${scan.cond})`;
  }
  return null;
};

const explain = async (tx: BmsTx, statement: ReturnType<typeof anomalyListStatement>): Promise<ScanOfScores[]> => {
  const result = await tx.execute<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>(sql`EXPLAIN (FORMAT JSON) ${statement}`);
  const plan = result.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
  if (!plan) throw new Error("E1.2b: EXPLAIN returned no plan");
  return scoreScans(plan);
};

/**
 * Plan section 2.4, a smoke check of the shipped plan (as `E1.4a` recorded, not the `OFFSET 0`
 * mutation gate — that is the text check in `tests/e1.2b-ml-anomaly-containment.test.ts`). 120 days
 * of hourly anomaly runs for two organizations, ten synthetic detectors per run, `ANALYZE`d inside
 * a rolled-back transaction: neither read plans a scan of `ml.anomaly_scores` unbound to a run or an
 * asset, as the fleet role (the superuser: both bypass row security) or as `bms_tenant` under its GUC.
 */
export async function assertNeitherReadScansAllScores(ctx: MlAnomalyFixtures): Promise<void> {
  await withRollback(ctx.superuserDb, async (tx) => {
    await tx.execute(sql`
      WITH planted AS (
        SELECT gen_random_uuid() AS id, o.org, o.asset,
               to_timestamp(${ctx.currentHourMs}::float8 / 1000.0) - make_interval(hours => h) + interval '5 minutes' AS started
          FROM (VALUES (${ctx.organizations.a}::uuid, ${ctx.assets.l2}::uuid),
                       (${ctx.organizations.b}::uuid, ${ctx.assets.p1}::uuid)) AS o(org, asset),
               generate_series(1, 120 * 24) AS h
      ), runs AS (
        INSERT INTO ml.model_runs (id, organization_id, model_name, model_version, config_hash,
                                   started_at, finished_at, rows_written, status)
        SELECT id, org, 'bms-anomaly', '0.1.0', repeat('b', 64), started, started, 10, 'succeeded'
          FROM planted
        RETURNING id
      )
      INSERT INTO ml.anomaly_scores (organization_id, asset_id, bucket, detector, score, contributing_points, model_run_id)
      SELECT p.org, p.asset, date_trunc('hour', p.started, 'UTC') - interval '1 hour', 'e12b_bulk_' || d, 0.5, '{}', p.id
        FROM planted p JOIN runs r ON r.id = p.id, generate_series(0, 9) AS d
    `);
    const count = await tx.execute<{ n: number }>(sql`SELECT count(*)::float8 AS n FROM ml.anomaly_scores`);
    expect(Number(count.rows[0]?.n)).toBeGreaterThan(55_000);
    await tx.execute(sql`SET LOCAL default_statistics_target = 1000`);
    await tx.execute(sql`ANALYZE ml.anomaly_scores`);
    await tx.execute(sql`ANALYZE ml.model_runs`);

    const H = ctx.currentHourMs;
    const sinceMs = H - 7 * 24 * HOUR_MS;
    const reads = [
      ["one asset, 31 days", assetAnomaliesStatement(ctx.assets.l2, H - 31 * 24 * HOUR_MS, H)],
      ["the list, no ids", anomalyListStatement(null, sinceMs)],
      ["the list, ids", anomalyListStatement([ctx.assets.l1, ctx.assets.l2, ctx.assets.p1], sinceMs)],
    ] as const;
    for (const role of ["fleet", "tenant"] as const) {
      if (role === "tenant") {
        await tx.execute(sql`SELECT set_config('app.current_organization', ${ctx.organizations.a}, true)`);
        await tx.execute(sql.raw("SET LOCAL ROLE bms_tenant"));
      }
      for (const [label, statement] of reads) {
        const scans = await explain(tx, statement);
        expect(scans.length, `${role} ${label}: the plan reads ml.anomaly_scores`).toBeGreaterThan(0);
        expect(
          scans.map(unboundedScan).filter((why) => why !== null),
          `${role} ${label}: a scan of ml.anomaly_scores that is not bound to a run or an asset`,
        ).toEqual([]);
      }
    }
    tx.rollback();
  });
}
