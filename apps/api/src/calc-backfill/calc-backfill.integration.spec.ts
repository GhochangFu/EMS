import { randomUUID } from "node:crypto";

import type pg from "pg";
import { expect } from "vitest";

import { assetPoints, assets, calcBackfillRuns, createDb, refreshAggregatesFrom } from "@bms/db";

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
import { CalcBackfillRunStore } from "./calc-backfill-run-store";
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
 * **Why the final refresh is asserted in the fakes spec, not here.**
 * `writeValues` refreshes each chunk's span itself, so dropping the walk's
 * last `refreshAggregates(from, to)` leaves the `_1h` claim below green. The
 * `(from, to)` call is held by `calc-backfill.service.spec.ts`.
 */

/** Per-run, so two instances of this file never sweep each other's rows (`tests/integration-fixture-isolation.test.ts`). */
const TEST_ASSET_PREFIX = `F4311-BF-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}-`;

export const SCHED_KEY = "F4311_BACKFILL_SCHED";
export const STREAM_KEY = "F4311_BACKFILL_STREAM";

const MINUTE = 60_000;
const BUCKETS = 180;
const KEPT_MINUTE = 30;

export type BackfillFixture = {
  readonly assetId: string;
  readonly measuredKey: string;
  readonly schedPointId: string;
  readonly streamPointId: string;
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
  return { assetId, measuredKey, schedPointId: idOf(SCHED_KEY), streamPointId: idOf(STREAM_KEY), fromMs, toMs };
}

/** Creates a `queued` run for the point and runs the processor on it, as the worker would. */
export async function runBackfill(pool: pg.Pool, fx: Fixtures, fixture: BackfillFixture, assetPointId: string): Promise<string> {
  const db = createDb(pool);
  const [run] = await db
    .insert(calcBackfillRuns)
    .values({
      organizationId: fx.organizationId,
      assetPointId,
      fromAt: new Date(fixture.fromMs),
      toAt: new Date(fixture.toMs),
    })
    .returning({ id: calcBackfillRuns.id });
  const runId = (run as { id: string }).id;
  const metrics = new MetricsService();
  const service = new CalcBackfillService(
    new CalcBackfillRunStore(db),
    new CalcDefinitionsService(db, metrics),
    new CalcScopeService(db),
    new CalcParametersService(db),
    new CalcWindowsService(pool, db),
    new CalcBackfillReads(pool),
    new CalcWriteService(db, db, pool, metrics),
  );
  const registration = runProcessor(calcBackfillQueue, { tenantDb: db, fleetDb: db }, (payload, ctx) =>
    service.run(payload, ctx.tx),
  );
  await registration.process({ data: { organizationId: fx.organizationId, runId, assetPointId } });
  return runId;
}

async function storedRows(pool: pg.Pool, fixture: BackfillFixture, pointKey: string) {
  const { rows } = await pool.query<{ time: Date; value: number }>(
    `SELECT time, value FROM telemetry.point_values
      WHERE asset_id = $1 AND point_key = $2 AND time >= $3 AND time < $4 ORDER BY time`,
    [fixture.assetId, pointKey, new Date(fixture.fromMs), new Date(fixture.toMs)],
  );
  return rows.map((row) => ({ minute: (new Date(row.time).getTime() - fixture.fromMs) / MINUTE, value: Number(row.value) }));
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
  pool: pg.Pool,
  fx: Fixtures,
  fixture: BackfillFixture,
): Promise<void> {
  await runBackfill(pool, fx, fixture, fixture.streamPointId);
  const written = (await storedRows(pool, fixture, STREAM_KEY)).map((row) => row.minute * MINUTE);
  const expected = Array.from({ length: BUCKETS }, (_, i) => (i + 1) * MINUTE - 53_000);
  expect(written).toEqual(expected);
}
