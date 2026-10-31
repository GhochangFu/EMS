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
  /**
   * The unaligned window ({@link UNALIGNED_FROM}, {@link UNALIGNED_TO}): 3 at
   * 00:45 on day 0, inside the window but in the hour bucket that starts
   * before it; 5 at 02:00; 777 at 00:40 on day 7, after the window's end but
   * in the hour bucket that starts before that end.
   */
  readonly assetEdge: string;
  /** One sample, 9 at 00:50 on day 0: only in the unaligned window's leading partial hour. */
  readonly assetLeadOnly: string;
}

const at = (minutes: number, seconds = 0): Date => new Date(BASE.getTime() + minutes * MINUTE_MS + seconds * 1_000);

/**
 * A 7-day window (the `1h` level) that starts and ends half way through a UTC
 * hour, the way an IST week does: `[00:30 day 0, 00:30 day 7)`. The rollups
 * bucket in UTC, so both ends cut an hour bucket.
 */
const UNALIGNED_FROM = at(30);
const UNALIGNED_TO = new Date(UNALIGNED_FROM.getTime() + 7 * DAY_MS);

export async function setupFixtures(pool: pg.Pool): Promise<Fixtures> {
  const fx: Fixtures = {
    assetA: randomUUID(),
    assetB: randomUUID(),
    assetEmpty: randomUUID(),
    outsider: randomUUID(),
    assetEdge: randomUUID(),
    assetLeadOnly: randomUUID(),
  };
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
    [at(45), fx.assetEdge, 3],
    [at(120), fx.assetEdge, 5],
    [new Date(UNALIGNED_TO.getTime() + 10 * MINUTE_MS), fx.assetEdge, 777],
    [at(50), fx.assetLeadOnly, 9],
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
    [fx.assetA, fx.assetB, fx.assetEmpty, fx.outsider, fx.assetEdge, fx.assetLeadOnly],
  ]);
}

function service(pool: pg.Pool): TelemetryService {
  // The fleet slot (`F4.297`'s `aggregate` zone read) is unused by the point-stats reads.
  return new TelemetryService(null as never, pool, null as never);
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

async function readUnaligned(pool: pg.Pool, assetIds: string[], to = UNALIGNED_TO): Promise<PointStatsByAsset> {
  return service(pool).pointStatsByAsset({ assetIds, pointKey: POINT_KEY, from: UNALIGNED_FROM, to, now: NOW });
}

/**
 * Review finding: the rollups bucket in UTC, so a week that ends half way
 * through an hour must not count that hour's samples after its end. The 777
 * planted 10 minutes after `to` is in no statistic, beside an aligned call
 * that reaches past it and counts it.
 */
export async function assertASampleAfterAnUnalignedEndIsNotCounted(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const aligned = await service(pool).pointStatsByAsset({
    assetIds: [fx.assetEdge],
    pointKey: POINT_KEY,
    from: BASE,
    to: new Date(BASE.getTime() + 8 * DAY_MS),
    now: NOW,
  });
  const seen = rowOf(aligned, fx.assetEdge);
  assert(seen.max === 777 && seen.sampleCount === 3, `the positive neighbour must count the 777, got ${JSON.stringify(seen)}`);

  const answer = await readUnaligned(pool, [fx.assetEdge]);
  assert(answer.bucketSeconds === 3_600, `the unaligned week must read the 1h level, got ${answer.bucketSeconds}`);
  const edge = rowOf(answer, fx.assetEdge);
  assert(edge.max === 5, `the 777 after the window's end must not be the max, got ${edge.max}`);
  assert(edge.sampleCount === 2, `only the 3 and the 5 are inside the window, got ${edge.sampleCount} samples`);
}

/**
 * The other end: the 3 at 00:45 is inside the window, in the hour bucket that
 * starts before it. It is counted (from the 1-minute level), so the minimum
 * and the mean are the window's.
 */
export async function assertASampleInTheLeadingPartialBucketIsCounted(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const edge = rowOf(await readUnaligned(pool, [fx.assetEdge]), fx.assetEdge);
  assert(edge.min === 3 && edge.avg === 4, `the 3 at 00:45 must be counted (min 3, mean 4), got ${JSON.stringify(edge)}`);
}

/**
 * The statistics and `last` cover the same period: an asset whose only
 * sample is in the leading partial hour is never answered as no data
 * (`sampleCount: 0`) beside a `last` that holds that sample.
 */
export async function assertTheStatisticsAndLastCoverTheSamePeriod(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const lead = rowOf(await readUnaligned(pool, [fx.assetLeadOnly]), fx.assetLeadOnly);
  assert(lead.last === 9, `the positive neighbour: last must be the 9 at 00:50, got ${JSON.stringify(lead)}`);
  assert(lead.sampleCount === 1 && lead.max === 9, `the 9 must be in the statistics too, got ${JSON.stringify(lead)}`);
}

/**
 * The answer names the period its statistics cover (`coveredFrom`,
 * `coveredTo`) beside the asked one: whole minutes inside `[from, to)`, so a
 * `to` with seconds is covered to the minute before it.
 */
export async function assertTheAnswerNamesThePeriodItCovers(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await readUnaligned(pool, [fx.assetEdge]);
  assert(
    answer.coveredFrom === UNALIGNED_FROM.toISOString() && answer.coveredTo === UNALIGNED_TO.toISOString(),
    `a minute-aligned window is covered whole, got ${answer.coveredFrom}..${answer.coveredTo}`,
  );
  const to = new Date(UNALIGNED_TO.getTime() + 25_000);
  const ragged = await readUnaligned(pool, [fx.assetEdge], to);
  assert(ragged.to === to.toISOString(), `the asked end is echoed, got ${ragged.to}`);
  assert(ragged.coveredTo === UNALIGNED_TO.toISOString(), `a to with seconds is covered to the minute before it, got ${ragged.coveredTo}`);
}

// --- `F4.296` (ADR 0099 Amendment 10 F1): the site summary --------------------------------------

async function summarise(pool: pg.Pool, assetIds: string[], spanMs: number, from: Date = BASE) {
  return service(pool).pointStatsSummary({ assetIds, pointKey: POINT_KEY, from, to: new Date(from.getTime() + spanMs), now: NOW });
}

/** The raw samples' own figures over `[from, to)`: what "equal to SQL on the same window" compares against. */
async function rawFigures(pool: pg.Pool, assetIds: string[], from: Date, to: Date) {
  const { rows } = await pool.query<{ min: number | null; avg: number | null; max: number | null; n: string }>(
    `SELECT min(value)::float8 AS min, avg(value)::float8 AS avg, max(value)::float8 AS max, count(*) AS n
       FROM telemetry.point_values
      WHERE asset_id = ANY($1::uuid[]) AND point_key = $2 AND time >= $3 AND time < $4`,
    [assetIds, POINT_KEY, from.toISOString(), to.toISOString()],
  );
  return rows[0]!;
}

/**
 * The site row equals SQL over the raw samples of the same window — min 1,
 * mean 43/7 (weighted by samples, not the mean of the two asset means), max
 * 14, 7 samples — at the `1m` level (1 hour) and the `1h` level (7 days).
 */
export async function assertTheSiteRowEqualsSqlOnTheSameWindow(pool: pg.Pool, fx: Fixtures): Promise<void> {
  for (const span of [HOUR_MS, 7 * DAY_MS]) {
    const ids = [fx.assetA, fx.assetB];
    const answer = await summarise(pool, ids, span);
    const raw = await rawFigures(pool, ids, BASE, new Date(BASE.getTime() + span));
    const { site } = answer;
    assert(Number(raw.n) === 7 && site.sampleCount === 7, `7 samples in the window, got raw ${raw.n} and site ${site.sampleCount}`);
    assert(site.min === raw.min && site.max === raw.max, `site min/max must be SQL's ${raw.min}/${raw.max}, got ${site.min}/${site.max}`);
    assert(site.avg !== null && raw.avg !== null && Math.abs(site.avg - raw.avg) < 1e-9, `site mean must be SQL's ${raw.avg}, got ${site.avg}`);
    assert(Math.abs((site.avg ?? 0) - 43 / 7) < 1e-9, `the mean is weighted by samples (43/7), not (1.75 + 12) / 2; got ${site.avg}`);
  }
}

/** The per-asset rows beside the site row are `pointStatsByAsset`'s figures; an asset with no sample has none. */
export async function assertTheSummaryRowsAreThePerAssetFigures(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await summarise(pool, [fx.assetA, fx.assetB, fx.assetEmpty], HOUR_MS);
  const ids = answer.rows.map((row) => row.assetId).sort();
  assert(JSON.stringify(ids) === JSON.stringify([fx.assetA, fx.assetB].sort()), `only A and B have samples, got ${JSON.stringify(ids)}`);
  const a = answer.rows.find((row) => row.assetId === fx.assetA);
  assert(a?.min === 1 && a.avg === 1.75 && a.max === 4 && a.sampleCount === 4, `A must be 1/1.75/4 over 4, got ${JSON.stringify(a)}`);
}

/** The containment: an asset not passed is in neither the site row nor a row, beside a call that passes it and sees its -500. */
export async function assertTheSummaryKeepsAnAssetNotPassedOut(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const passed = await summarise(pool, [fx.assetA, fx.outsider], HOUR_MS);
  assert(passed.site.min === -500, `the positive neighbour must see the outsider's -500, got ${passed.site.min}`);
  const answer = await summarise(pool, [fx.assetA, fx.assetB], HOUR_MS);
  assert(answer.site.min === 1 && answer.site.max === 14, `the site must hold A and B only, got ${JSON.stringify(answer.site)}`);
  assert(!answer.rows.some((row) => row.assetId === fx.outsider), "the outsider must be in no row");
}

/** A set with no sample answers a null site row with 0 samples and no rows. */
export async function assertASiteWithNoSampleHasANullSiteRow(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const answer = await summarise(pool, [fx.assetEmpty], HOUR_MS);
  assert(
    JSON.stringify([answer.site, answer.rows]) === JSON.stringify([{ min: null, avg: null, max: null, sampleCount: 0 }, []]),
    `got ${JSON.stringify([answer.site, answer.rows])}`,
  );
}
