import { randomUUID } from "node:crypto";

import type pg from "pg";

import type { PointStatsByAsset } from "@bms/shared";

import { TelemetryService } from "./telemetry.service";

/**
 * `F4.291` PR 3 (ADR 0099 Amendment 9 E5(c)) — `TelemetryService.pointStatsByAsset`
 * against a real TimescaleDB: the per-asset statistics, `last` (owner ruling
 * P6), the level the window's length reads, and the `ANY(ids)` containment.
 *
 * **The containment is the claim that matters.** `telemetry.*` carries no Row
 * Level Security, so the `asset_id` predicate in each of the two fragments is
 * the only thing that keeps an asset the caller did not pass out of the
 * answer. {@link Fixtures.outsider} has samples on the same key inside the
 * window, a value below every other minimum and the newest bucket of all: if
 * either fragment drops its predicate, it shows up — as a row of its own
 * (`groupedScalarSql`) or as every asset's `last` (`lastBucketSql`). Each
 * absence claim sits beside a positive call that passes it.
 *
 * **Fixture placement** is `pue-ratio.integration.spec.ts`'s: a fixed
 * far-future window ({@link BASE}) that is ahead of all four aggregates'
 * watermarks, so the real-time branch serves it from raw through the whole
 * `_1d ← _1h ← _5m ← _1m` chain, no refresh is called, and deleting the raw
 * rows leaves nothing behind. Rows carry this run's random asset ids only;
 * `telemetry.point_values` has no foreign key to `bms.assets`, so no `bms.*`
 * row is written. `assertTheFixtureIsVisible` runs first and names the
 * mechanism if the assumption ever stops holding.
 *
 * Raw `value` is NOT NULL, so a bucket with no counted sample cannot be
 * planted from raw; `lastBucketSql`'s `HAVING` guard is pinned by
 * `point-aggregate-window.spec.ts` instead.
 */

const POINT_KEY = "f4291_point_stats_kw";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Far future, on a UTC midnight, so the `1d` bucket of the fixture starts at `from`. */
const BASE = new Date("2031-07-01T00:00:00.000Z");
/** The wall clock the service's retention guard reads: the fixture is in its future. */
const NOW = new Date();

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export interface Fixtures {
  /** Uneven samples: 1, 1, 1 in minute 0 and 4 in minute 3, so the weighted mean (1.75) is not the bucket mean (2.5). */
  readonly assetA: string;
  /** 10, 12, 14 in minutes 0–2: mean 12, last 14 at minute 2. */
  readonly assetB: string;
  /** No sample at all: absent from the service's rows. */
  readonly assetEmpty: string;
  /** Same key, inside the window: -500 at minute 0, 999 at minute 5 (the newest bucket of all). Never passed except by the positive neighbour. */
  readonly outsider: string;
}

const at = (minutes: number, seconds = 0): Date => new Date(BASE.getTime() + minutes * MINUTE_MS + seconds * 1_000);

export async function setupFixtures(pool: pg.Pool): Promise<Fixtures> {
  const fx: Fixtures = { assetA: randomUUID(), assetB: randomUUID(), assetEmpty: randomUUID(), outsider: randomUUID() };
  const samples: Array<[Date, string, number]> = [
    [at(0, 0), fx.assetA, 1],
    [at(0, 10), fx.assetA, 1],
    [at(0, 20), fx.assetA, 1],
    [at(3), fx.assetA, 4],
    [at(0), fx.assetB, 10],
    [at(1), fx.assetB, 12],
    [at(2), fx.assetB, 14],
    [at(0), fx.outsider, -500],
    [at(5), fx.outsider, 999],
  ];
  for (const [time, assetId, value] of samples) {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES ($1, $2, $3, $4, 'kW')`,
      [time.toISOString(), assetId, POINT_KEY, value],
    );
  }
  return fx;
}

/** Deletes this run's rows by a constant list of ids (`tests/adr-0024-retention-bounds.test.ts`). */
export async function cleanup(pool: pg.Pool, fx: Fixtures | undefined): Promise<void> {
  if (!fx) return;
  await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [
    [fx.assetA, fx.assetB, fx.assetEmpty, fx.outsider],
  ]);
}

function service(pool: pg.Pool): TelemetryService {
  return new TelemetryService(null as never, pool);
}

async function read(pool: pg.Pool, assetIds: string[], spanMs: number): Promise<PointStatsByAsset> {
  return service(pool).pointStatsByAsset({ assetIds, pointKey: POINT_KEY, from: BASE, to: new Date(BASE.getTime() + spanMs), now: NOW });
}

function rowOf(answer: PointStatsByAsset, assetId: string) {
  const row = answer.rows.find((r) => r.assetId === assetId);
  if (!row) throw new Error(`no row for ${assetId}: ${JSON.stringify(answer.rows)}`);
  return row;
}

/** The fixture reaches the `1m` level through the real-time branch (else every claim below is vacuous). */
export async function assertTheFixtureIsVisible(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*) AS n FROM telemetry.point_values_1m WHERE asset_id = ANY($1::uuid[]) AND point_key = $2",
    [[fx.assetA, fx.assetB, fx.outsider], POINT_KEY],
  );
  assert(
    Number(rows[0]?.n) === 7,
    `expected 7 minute buckets for the fixture, got ${rows[0]?.n}. The real-time branch no longer serves a ` +
      "far-future window from raw, so every claim in this suite would read nothing.",
  );
}

/** min / avg / max / sampleCount per asset are exact; the mean is weighted by samples (1.75, not 2.5). */
export async function assertTheStatisticsAreExactPerAsset(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, [fx.assetA, fx.assetB], HOUR_MS);
  const a = rowOf(answer, fx.assetA);
  const b = rowOf(answer, fx.assetB);
  assert(a.min === 1 && a.max === 4, `A min/max must be 1/4, got ${a.min}/${a.max}`);
  assert(a.avg === 1.75, `A's mean must be weighted by samples (1.75), got ${a.avg}`);
  assert(a.sampleCount === 4, `A has 4 samples, got ${a.sampleCount}`);
  assert(b.min === 10 && b.max === 14 && b.avg === 12 && b.sampleCount === 3, `B must be 10/12/14 over 3, got ${JSON.stringify(b)}`);
}

/** `last` is the newest bucket's mean and `lastAt` that bucket's start, per asset. */
export async function assertLastIsTheNewestBucketPerAsset(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, [fx.assetA, fx.assetB], HOUR_MS);
  const a = rowOf(answer, fx.assetA);
  const b = rowOf(answer, fx.assetB);
  assert(a.last === 4 && a.lastAt === at(3).toISOString(), `A's last must be 4 at minute 3, got ${a.last} at ${a.lastAt}`);
  assert(b.last === 14 && b.lastAt === at(2).toISOString(), `B's last must be 14 at minute 2, got ${b.last} at ${b.lastAt}`);
}

/** An asset with no sample in the window has no row (the tool fills it), beside one that has. */
export async function assertAnAssetWithNoSampleHasNoRow(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await read(pool, [fx.assetA, fx.assetEmpty], HOUR_MS);
  assert(
    JSON.stringify(answer.rows.map((r) => r.assetId)) === JSON.stringify([fx.assetA]),
    `only A has samples, got ${JSON.stringify(answer.rows.map((r) => r.assetId))}`,
  );
}

/**
 * The containment: an asset not passed is in no row and in no `last`, beside
 * a call that passes it and sees it (its -500 minimum and its 999 last).
 */
export async function assertAnAssetNotPassedIsInNoRowAndNoLast(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const passed = await read(pool, [fx.assetA, fx.outsider], HOUR_MS);
  const outsider = rowOf(passed, fx.outsider);
  assert(outsider.min === -500 && outsider.last === 999, `the positive neighbour must see the outsider, got ${JSON.stringify(outsider)}`);

  const answer = await read(pool, [fx.assetA, fx.assetB], HOUR_MS);
  const ids = answer.rows.map((r) => r.assetId).sort();
  assert(
    JSON.stringify(ids) === JSON.stringify([fx.assetA, fx.assetB].sort()),
    `the statistics must hold the passed assets only, got ${JSON.stringify(ids)}`,
  );
  for (const row of answer.rows) {
    assert(row.min !== -500, `${row.assetId}'s min must not be the outsider's -500`);
    assert(row.last !== 999, `${row.assetId}'s last must not be the outsider's newest bucket (999)`);
  }
}

/** A 31-day window reads the `1d` level and a 7-day one `1h`; `last` stays the newest 1-minute bucket (ruling P6). */
export async function assertTheWindowPicksTheLevelAndLastStaysAtOneMinute(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const month = await read(pool, [fx.assetA], 31 * DAY_MS);
  assert(month.bucketSeconds === 86_400, `31 days must read the 1d level, got ${month.bucketSeconds}`);
  const a = rowOf(month, fx.assetA);
  assert(a.avg === 1.75 && a.min === 1 && a.max === 4, `the 1d level must keep A's statistics, got ${JSON.stringify(a)}`);
  assert(a.lastAt === at(3).toISOString(), `last must stay the newest 1-minute bucket at 31 days, got ${a.lastAt}`);

  const week = await read(pool, [fx.assetA], 7 * DAY_MS);
  assert(week.bucketSeconds === 3_600, `7 days must read the 1h level, got ${week.bucketSeconds}`);
  assert(rowOf(week, fx.assetA).avg === 1.75, "the 1h level must keep A's weighted mean");
}
