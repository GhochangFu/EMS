import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { assetPoints, assets, calcBackfillRuns, createDb, refreshAggregatesFrom } from "@bms/db";

import { inputKey } from "../calc/calc-batch";
import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { CalcScopeService } from "../calc/calc-scope.service";
import { CalcWindowsService } from "../calc/calc-windows.service";
import { CalcWriteService } from "../calc/calc-write.service";
import { MetricsService } from "../observability/metrics.service";
import { calcBackfillQueue } from "../queue/calc-backfill";
import { runProcessor } from "../queue/queue-processor";
import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { CalcBackfillReads } from "./calc-backfill-reads";
import { BACKFILL_STALE_MINUTES, CalcBackfillRunStore } from "./calc-backfill-run-store";
import { CalcBackfillService } from "./calc-backfill.service";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill processor against a
 * real database, run through `runProcessor` exactly as the worker runs it
 * (the claim on a tenant transaction, the walk after its commit). No Redis:
 * the processor body is what is under test, not BullMQ's delivery.
 *
 * The fixture: one template-less asset carrying two standalone points over
 * the measured key `M` (`fx.pointKeys[0]`, a registered catalog code):
 *
 * - `SCHED` — `{M} * 2`, scheduled every 60 s, inputs valid 300 s;
 * - `STREAM` — `{M} + 1`, streaming, inputs valid 300 s.
 *
 * `M` has one sample 53 s before every minute of a three-hour window two days
 * back, valued by its minute index `k`, so bucket `k` reads `k` (53 s old,
 * fresh) and `SCHED` stores `2k`. One `SCHED` value is stored before the run
 * at minute 30 (`-1`): the backfill must not overwrite it — the gate itself
 * is `calc-write.integration.spec.ts`'s; this spec proves the walk reaches it.
 *
 * **Row-level security is exercised** (`F4.311` PR 5 review): the claim, the
 * store's `current` / `progress` / `finish`, the reads and the value writes
 * run on a **`bms_tenant`** pool, as the worker's `TENANT_DRIZZLE` /
 * `TENANT_POOL` do, so migration `0123`'s policy (its parent-`asset_points`
 * half included) binds every run-store statement. The `bms_fleet` pool
 * (BYPASSRLS) seeds, reads the outcome, and serves the fleet reads the
 * worker also makes on `FLEET_DRIZZLE`.
 *
 * Three more scheduled points over `M` serve the review's claims, each its
 * own so their rows never meet: `QUIET` (no NOTIFY for history), `STALE` (a
 * `running` run with no heartbeat is re-claimed and resumes) and `LIVE` (a
 * `running` run with a fresh heartbeat is left alone).
 *
 * **Why the final refresh is asserted in the fakes spec, not here.**
 * `writeValues` refreshes each chunk's span itself, so dropping the walk's
 * last `refreshAggregates(from, to)` leaves the `_1h` claim below green. The
 * `(from, to)` call is held by `calc-backfill.service.spec.ts`.
 */

/** Per-run, so two instances of this file never sweep each other's rows (`tests/integration-fixture-isolation.test.ts`). */
const TEST_ASSET_PREFIX = `F4311-BF-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

export const SCHED_KEY = "F4311_BACKFILL_SCHED";
export const STREAM_KEY = "F4311_BACKFILL_STREAM";
export const QUIET_KEY = "F4311_BACKFILL_QUIET";
export const STALE_KEY = "F4311_BACKFILL_STALE";
export const LIVE_KEY = "F4311_BACKFILL_LIVE";

/** The fleet pool (seeding, outcomes, the worker's fleet reads) and the tenant pool (everything RLS binds). */
export type BackfillPools = { readonly fleet: pg.Pool; readonly tenant: pg.Pool };

const MINUTE = 60_000;
const BUCKETS = 180;
const KEPT_MINUTE = 30;

export type BackfillFixture = {
  readonly assetId: string;
  readonly measuredKey: string;
  readonly schedPointId: string;
  readonly streamPointId: string;
  readonly quietPointId: string;
  readonly stalePointId: string;
  readonly livePointId: string;
  readonly fromMs: number;
  readonly toMs: number;
};

export async function cleanup(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM bms.assets WHERE code LIKE $1`, [
    `${TEST_ASSET_PREFIX}%`,
  ]);
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [ids]);
  // Runs cascade from their asset_points rows.
  await pool.query(`DELETE FROM bms.asset_points WHERE asset_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM bms.assets WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Re-covers the window after the delete, so no materialized row outlives the suite (the `0027` obligation). */
export async function refreshAfterCleanup(pool: pg.Pool, fixture: BackfillFixture | undefined): Promise<void> {
  if (fixture) {
    await retryOnConcurrentRefresh(() =>
      refreshAggregatesFrom(pool, new Date(fixture.fromMs - 3_600_000), new Date(fixture.toMs + 3_600_000)),
    );
  }
}

export async function seed(pool: pg.Pool, fx: Fixtures): Promise<BackfillFixture> {
  const db = createDb(pool);
  const measuredKey = (fx.pointKeys[0] as { code: string }).code;
  const fromMs = Math.floor((Date.now() - 2 * 86_400_000) / 3_600_000) * 3_600_000;
  const toMs = fromMs + BUCKETS * MINUTE;
  const [asset] = await db
    .insert(assets)
    .values({
      organizationId: fx.organizationId,
      code: `${TEST_ASSET_PREFIX}BARE`,
      name: "Backfill Fixture",
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
      templateId: null,
    })
    .returning({ id: assets.id });
  const assetId = (asset as { id: string }).id;
  const point = (pointKey: string, formula: string, trigger: "scheduled" | "streaming") => ({
    organizationId: fx.organizationId,
    assetId,
    pointKey,
    sourceDataKey: `computed:${pointKey}`,
    sourceKind: "computed",
    rtuId: null,
    formula,
    formulaDialect: "bms-calc-v1",
    calcTrigger: trigger,
    calcIntervalSeconds: trigger === "scheduled" ? 60 : null,
    maxInputAgeSeconds: 300,
  });
  const rows = await db
    .insert(assetPoints)
    .values([
      point(SCHED_KEY, `{${measuredKey}} * 2`, "scheduled"),
      point(STREAM_KEY, `{${measuredKey}} + 1`, "streaming"),
      point(QUIET_KEY, `{${measuredKey}} * 4`, "scheduled"),
      point(STALE_KEY, `{${measuredKey}} * 5`, "scheduled"),
      point(LIVE_KEY, `{${measuredKey}} * 6`, "scheduled"),
    ])
    .returning({ id: assetPoints.id, pointKey: assetPoints.pointKey });
  const idOf = (key: string) => rows.find((row) => row.pointKey === key)?.id as string;

  // M at 53 s before every minute k = 0 … BUCKETS, valued k.
  const times: Date[] = [];
  const values: number[] = [];
  for (let k = 0; k <= BUCKETS; k += 1) {
    times.push(new Date(fromMs + k * MINUTE - 53_000));
    values.push(k);
  }
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
     SELECT t, $1, $2, v FROM unnest($3::timestamptz[], $4::float8[]) AS s(t, v)`,
    [assetId, measuredKey, times, values],
  );
  await pool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES ($1, $2, $3, -1)`,
    [new Date(fromMs + KEPT_MINUTE * MINUTE), assetId, SCHED_KEY],
  );
  return {
    assetId,
    measuredKey,
    schedPointId: idOf(SCHED_KEY),
    streamPointId: idOf(STREAM_KEY),
    quietPointId: idOf(QUIET_KEY),
    stalePointId: idOf(STALE_KEY),
    livePointId: idOf(LIVE_KEY),
    fromMs,
    toMs,
  };
}

/** Inserts a `queued` run for the point over the fixture's window (on the fleet pool — a fixture write). */
async function createRun(pools: BackfillPools, fx: Fixtures, fixture: BackfillFixture, assetPointId: string): Promise<string> {
  const [run] = await createDb(pools.fleet)
    .insert(calcBackfillRuns)
    .values({
      organizationId: fx.organizationId,
      assetPointId,
      fromAt: new Date(fixture.fromMs),
      toAt: new Date(fixture.toMs),
    })
    .returning({ id: calcBackfillRuns.id });
  return (run as { id: string }).id;
}

/** The worker's wiring: tenant handles where the worker injects `TENANT_*`, fleet where it injects `FLEET_DRIZZLE`. */
function backfillReads(pools: BackfillPools): CalcBackfillReads {
  return new CalcBackfillReads(pools.tenant);
}

/** Runs the processor on an existing run, as the worker would. */
export async function processRun(pools: BackfillPools, fx: Fixtures, runId: string, assetPointId: string): Promise<void> {
  const tenantDb = createDb(pools.tenant);
  const fleetDb = createDb(pools.fleet);
  const metrics = new MetricsService();
  const service = new CalcBackfillService(
    new CalcBackfillRunStore(tenantDb, fleetDb),
    new CalcDefinitionsService(fleetDb, metrics),
    new CalcScopeService(fleetDb),
    new CalcParametersService(fleetDb),
    new CalcWindowsService(pools.tenant, fleetDb),
    backfillReads(pools),
    new CalcWriteService(tenantDb, fleetDb, pools.tenant, metrics),
  );
  const registration = runProcessor(calcBackfillQueue, { tenantDb, fleetDb }, (payload, ctx) =>
    service.run(payload, ctx.tx),
  );
  await registration.process({ data: { organizationId: fx.organizationId, runId, assetPointId } });
}

/** Creates a `queued` run for the point and runs the processor on it, as the worker would. */
export async function runBackfill(
  pools: BackfillPools,
  fx: Fixtures,
  fixture: BackfillFixture,
  assetPointId: string,
): Promise<string> {
  const runId = await createRun(pools, fx, fixture, assetPointId);
  await processRun(pools, fx, runId, assetPointId);
  return runId;
}

async function storedRows(pool: pg.Pool, fixture: BackfillFixture, pointKey: string) {
  const { rows } = await pool.query<{ time: Date; value: number }>(
    `SELECT time, value FROM telemetry.point_values
      WHERE asset_id = $1 AND point_key = $2 AND time >= $3 AND time < $4 ORDER BY time`,
    [fixture.assetId, pointKey, new Date(fixture.fromMs), new Date(fixture.toMs)],
  );
  return rows.map((row) => {
    // `offsetMs` is exact; `minute` is offsetMs / MINUTE and is fractional for a
    // time off the minute grid — multiplying it back by MINUTE adds float noise
    // (246999.99999999997 for 247000), so a claim about exact times reads offsetMs.
    const offsetMs = new Date(row.time).getTime() - fixture.fromMs;
    return { offsetMs, minute: offsetMs / MINUTE, value: Number(row.value) };
  });
}

/** One stored row per bucket of the window. */
export async function assertOneRowPerBucket(pool: pg.Pool, fixture: BackfillFixture): Promise<void> {
  expect((await storedRows(pool, fixture, SCHED_KEY)).map((row) => row.minute)).toEqual(
    Array.from({ length: BUCKETS }, (_, k) => k),
  );
}

/** Every backfilled bucket holds `{M} * 2` as of that bucket (minute 30 excepted — it was stored before). */
export async function assertEveryBucketHasTheFormulasValue(pool: pg.Pool, fixture: BackfillFixture): Promise<void> {
  const wrong = (await storedRows(pool, fixture, SCHED_KEY)).filter(
    (row) => row.minute !== KEPT_MINUTE && row.value !== 2 * row.minute,
  );
  expect(wrong).toEqual([]);
}

/** The value stored before the run survives: the walk never overwrites. */
export async function assertAPreExistingValueSurvives(pool: pg.Pool, fixture: BackfillFixture): Promise<void> {
  const kept = (await storedRows(pool, fixture, SCHED_KEY)).find((row) => row.minute === KEPT_MINUTE);
  expect(kept?.value).toBe(-1);
}

/** The run ends `done` with `done_through = to_at`. */
export async function assertTheRunEndsDone(pool: pg.Pool, runId: string): Promise<void> {
  const { rows } = await pool.query<{ status: string; reached: boolean }>(
    `SELECT status, done_through = to_at AS reached FROM bms.calc_backfill_runs WHERE id = $1`,
    [runId],
  );
  expect(rows[0]).toEqual({ status: "done", reached: true });
}

/** The `_1h` aggregate holds the window's first hour for the backfilled point. */
export async function assertTheHourlyAggregateHasTheBucket(pool: pg.Pool, fixture: BackfillFixture): Promise<void> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT sample_count::int AS n FROM telemetry.point_values_1h
      WHERE asset_id = $1 AND point_key = $2 AND bucket = $3`,
    [fixture.assetId, SCHED_KEY, new Date(fixture.fromMs)],
  );
  expect(rows[0]?.n).toBe(60);
}

/** A streaming point is written at its input's stored times inside the window. */
export async function assertAStreamingPointWritesAtTheInputTimes(
  pools: BackfillPools,
  fx: Fixtures,
  fixture: BackfillFixture,
): Promise<void> {
  await runBackfill(pools, fx, fixture, fixture.streamPointId);
  const written = (await storedRows(pools.fleet, fixture, STREAM_KEY)).map((row) => row.offsetMs);
  const expected = Array.from({ length: BUCKETS }, (_, i) => (i + 1) * MINUTE - 53_000);
  expect(written).toEqual(expected);
}

// ---- PR 5 review ----------------------------------------------------------

/**
 * A backfill issues no `bms_telemetry` NOTIFY for its rows. A dedicated
 * session LISTENs during the `QUIET` run; any payload naming the fixture's
 * asset is a failure (other suites may notify concurrently, so the filter is
 * the asset, never a count). The anti-vacuity half: the run did write rows.
 */
export async function assertABackfillNotifiesNothing(
  pools: BackfillPools,
  fx: Fixtures,
  fixture: BackfillFixture,
): Promise<void> {
  const listener = await pools.fleet.connect();
  const heard: string[] = [];
  try {
    listener.on("notification", (message) => {
      if (message.channel === "bms_telemetry" && message.payload?.includes(fixture.assetId)) {
        heard.push(message.payload);
      }
    });
    await listener.query("LISTEN bms_telemetry");
    await runBackfill(pools, fx, fixture, fixture.quietPointId);
    // A NOTIFY is delivered at its transaction's commit; give the socket a beat.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await listener.query("UNLISTEN bms_telemetry");
  } finally {
    listener.release();
  }
  expect((await storedRows(pools.fleet, fixture, QUIET_KEY)).length, "anti-vacuity: the run wrote rows").toBe(BUCKETS);
  expect(heard).toEqual([]);
}

const STALE_DONE_THROUGH_MINUTE = 89;

/** Inserts a `running` run whose heartbeat (`updated_at`) is `ageMinutes` old, walked through minute 89. */
async function runningRun(
  pools: BackfillPools,
  fx: Fixtures,
  fixture: BackfillFixture,
  assetPointId: string,
  ageMinutes: number,
): Promise<string> {
  const { rows } = await pools.fleet.query<{ id: string }>(
    `INSERT INTO bms.calc_backfill_runs
       (organization_id, asset_point_id, from_at, to_at, status, done_through, started_at, updated_at)
     VALUES ($1, $2, $3, $4, 'running', $5, now() - make_interval(mins => $6), now() - make_interval(mins => $6))
     RETURNING id`,
    [
      fx.organizationId,
      assetPointId,
      new Date(fixture.fromMs),
      new Date(fixture.toMs),
      new Date(fixture.fromMs + STALE_DONE_THROUGH_MINUTE * MINUTE),
      ageMinutes,
    ],
  );
  return (rows[0] as { id: string }).id;
}

async function statusOf(pool: pg.Pool, runId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(`SELECT status FROM bms.calc_backfill_runs WHERE id = $1`, [runId]);
  return rows[0]?.status;
}

/**
 * A `running` run whose heartbeat is one minute past the stale bound — a
 * worker that died mid-walk — and its re-delivered job, processed. Returns
 * the run's id; the claims below read the outcome.
 */
export async function reclaimAStaleRun(pools: BackfillPools, fx: Fixtures, fixture: BackfillFixture): Promise<string> {
  const runId = await runningRun(pools, fx, fixture, fixture.stalePointId, BACKFILL_STALE_MINUTES + 1);
  await processRun(pools, fx, runId, fixture.stalePointId);
  return runId;
}

/** The stale run was re-claimed by its re-delivered job and ended `done`. */
export async function assertAStaleRunningRunIsReclaimed(fleet: pg.Pool, staleRunId: string): Promise<void> {
  expect(await statusOf(fleet, staleRunId)).toBe("done");
}

/** …and resumes after `done_through`: the walk wrote minutes 90…179 and nothing at or before 89. */
export async function assertAReclaimedRunResumesAfterDoneThrough(fleet: pg.Pool, fixture: BackfillFixture): Promise<void> {
  const minutes = (await storedRows(fleet, fixture, STALE_KEY)).map((row) => row.minute);
  expect(minutes).toEqual(
    Array.from({ length: BUCKETS - STALE_DONE_THROUGH_MINUTE - 1 }, (_, i) => STALE_DONE_THROUGH_MINUTE + 1 + i),
  );
}

/** A `running` run with a fresh heartbeat is not claimed: it stays `running` and nothing is written. */
export async function assertALiveRunningRunIsNotClaimed(
  pools: BackfillPools,
  fx: Fixtures,
  fixture: BackfillFixture,
): Promise<void> {
  const runId = await runningRun(pools, fx, fixture, fixture.livePointId, 1);
  await processRun(pools, fx, runId, fixture.livePointId);
  expect({ status: await statusOf(pools.fleet, runId), rows: (await storedRows(pools.fleet, fixture, LIVE_KEY)).length }).toEqual({
    status: "running",
    rows: 0,
  });
}

/**
 * An input stored with sub-millisecond precision is read at the instant
 * `readInputTimes` truncated it to: stored at `t + 500 µs`, read as of `t`.
 * Placed 30 minutes before the window, where `M` has no other sample.
 */
export async function assertASubMillisecondSampleIsReadAtItsInstant(
  pools: BackfillPools,
  fixture: BackfillFixture,
): Promise<void> {
  const at = new Date(fixture.fromMs - 30 * MINUTE);
  await pools.fleet.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
     VALUES ($1::timestamptz + interval '500 microseconds', $2, $3, 4242)`,
    [at, fixture.assetId, fixture.measuredKey],
  );
  const reads = backfillReads(pools);
  const instants = await reads.readInputTimes(
    fixture.assetId,
    [fixture.measuredKey],
    at.getTime() - MINUTE,
    at.getTime() + MINUTE,
    10,
  );
  const samples = await reads.readSamples([{ assetId: fixture.assetId, pointKey: fixture.measuredKey }], instants, 300);
  expect((samples.get(inputKey(fixture.assetId, fixture.measuredKey)) ?? []).map((sample) => Number(sample.value))).toEqual([4242]);
}
