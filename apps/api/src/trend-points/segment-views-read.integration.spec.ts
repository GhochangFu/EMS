import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import { resolveSiteTimeZone } from "@bms/shared";
import type pg from "pg";
import { expect } from "vitest";

import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { recordingPool } from "../testing/recording-pool";
import { segmentSeriesRead, segmentWindowReads } from "./segment-views-read";
import { fillSeries } from "./segment-views.pure";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 4) — the segment view's two
 * telemetry statements against the real continuous aggregates, and their
 * shape through a recording pool. Vitest entry point: the sibling `.test.ts`,
 * which owns the pools and the fixture lifecycle.
 *
 * ## The fixture
 *
 * One organization this run creates, with three assets coded with a
 * `randomUUID` part, and `kw` samples placed against an hour `H` (three hours
 * before setup, on the hour):
 *
 * - asset A: **1, 1, 1 in `H`'s first 5-minute bucket and 4 in its second**,
 *   so the two `_5m` rows carry `sample_count` 3 and 1: the weighted mean is
 *   7 / 4 = 1.75, a mean of the rows' means (1 + 4) / 2 = 2.5. Plus one 9 at
 *   `H − 30 min`, the compare period.
 * - asset B: one 7 at 20:10Z on the last UTC day whose 20:00Z hour is complete,
 *   which is 01:40 the next day in `Asia/Kolkata`.
 * - asset C, outside every list: 1 000 at A's instants, so a read that drops
 *   the asset bound takes it in and reddens.
 *
 * Committed, not rolled back: a continuous aggregate refresh cannot see an
 * uncommitted row. Cleanup deletes telemetry by these asset ids, re-refreshes,
 * then deletes the organization (the `trend-strip-read.integration.spec.ts`
 * reasoning).
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const KOLKATA = resolveSiteTimeZone("Asia/Kolkata", null);
const FOREIGN_KW = 1_000;
const COMPARE_KW = 9;
const B_KW = 7;

export interface SegmentViewsReadFixture {
  readonly assetA: string;
  readonly assetB: string;
  readonly assetC: string;
  readonly organizationId: string;
  /** `H`: the hour A's current samples fall in. */
  readonly hour: Date;
  /** B's one sample: 20:10Z. */
  readonly bAt: Date;
  /** The earliest instant written, for the refresh. */
  readonly from: Date;
}

function fail(message: string): never {
  throw new Error(message);
}

async function dropOrganization(superuser: pg.Pool, organizationId: string): Promise<void> {
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = $1`, [organizationId]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [organizationId]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = $1`, [organizationId]);
}

/** The last 20:10Z whose whole 20:00Z hour is at least an hour past. */
function lastCompleteTwentyTen(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 20, 10);
  return new Date(today + HOUR_MS <= now.getTime() - HOUR_MS ? today : today - DAY_MS);
}

/**
 * Builds the organization and its assets (superuser: `bms.assets` is
 * FORCE-policied), writes the telemetry and refreshes the aggregates (owner).
 * Cleans up before rethrowing on failure.
 */
export async function setUpSegmentViewsReadFixture(superuser: pg.Pool, owner: pg.Pool): Promise<SegmentViewsReadFixture> {
  const run = randomUUID().slice(0, 8).toUpperCase();
  const code = `SVR-${run}`;
  const now = new Date();
  const hour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - 3 * HOUR_MS);
  const bAt = lastCompleteTwentyTen(now);
  const { rows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [code, `F4.302 segment views read ${code}`],
  );
  const organizationId = rows[0]?.id ?? fail(`organization ${code} was not inserted`);
  try {
    const { rows: loc } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, NULL) RETURNING id`,
      [organizationId, `${code}-L`, `${code}-l`.toLowerCase(), `F4.302 ${code} site`],
    );
    const locationId = loc[0]?.id ?? fail(`location of ${code} was not inserted`);
    const asset = async (suffix: string): Promise<string> => {
      const { rows: a } = await superuser.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $3, 'F4.302 segment views read',
                 (SELECT code FROM bms.asset_domains ORDER BY created_at, code LIMIT 1))
         RETURNING id`,
        [organizationId, locationId, `${code}-${suffix}`],
      );
      return a[0]?.id ?? fail(`asset ${suffix} was not inserted`);
    };
    const from = new Date(Math.min(bAt.getTime(), hour.getTime() - HOUR_MS) - HOUR_MS);
    const fx: SegmentViewsReadFixture = {
      assetA: await asset("A"),
      assetB: await asset("B"),
      assetC: await asset("C"),
      organizationId,
      hour,
      bAt,
      from,
    };

    const times: string[] = [];
    const ids: string[] = [];
    const values: number[] = [];
    const sample = (id: string, at: Date, value: number): void => {
      times.push(at.toISOString());
      ids.push(id);
      values.push(value);
    };
    for (const minute of [1, 2, 3]) {
      sample(fx.assetA, new Date(hour.getTime() + minute * MINUTE_MS), 1);
      sample(fx.assetC, new Date(hour.getTime() + minute * MINUTE_MS), FOREIGN_KW);
    }
    sample(fx.assetA, new Date(hour.getTime() + 6 * MINUTE_MS), 4);
    sample(fx.assetC, new Date(hour.getTime() + 6 * MINUTE_MS), FOREIGN_KW);
    sample(fx.assetA, new Date(hour.getTime() - 30 * MINUTE_MS), COMPARE_KW);
    sample(fx.assetB, bAt, B_KW);

    try {
      await owner.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         SELECT t, a::uuid, 'kw', v, 'kW'
         FROM unnest($1::timestamptz[], $2::uuid[], $3::float8[]) AS x(t, a, v)`,
        [times, ids, values],
      );
      await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, from));
    } catch (err) {
      await cleanupSegmentViewsReadFixture(superuser, owner, fx);
      throw err;
    }
    return fx;
  } catch (err) {
    await dropOrganization(superuser, organizationId).catch(() => undefined);
    throw err;
  }
}

/** Deletes this run's telemetry by asset id, re-refreshes, then the organization. Warns, never throws. */
export async function cleanupSegmentViewsReadFixture(
  superuser: pg.Pool,
  owner: pg.Pool,
  fx: SegmentViewsReadFixture,
): Promise<void> {
  try {
    for (const id of [fx.assetA, fx.assetB, fx.assetC]) {
      await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = 'kw'`, [id]);
    }
    await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, fx.from));
    await dropOrganization(superuser, fx.organizationId);
  } catch (err: unknown) {
    process.stderr.write(
      `\n[F4.302] WARNING: segment views read fixture cleanup failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Leftover rows may remain. Repair the aggregates with: pnpm db:refresh-aggregates\n\n",
    );
  }
}

/** The current window `[H, H + 1 h − 1 ms]` and the compare window before it. */
function windows(fx: SegmentViewsReadFixture) {
  const start = fx.hour;
  return [
    { idx: 0, start, end: new Date(start.getTime() + HOUR_MS - 1) },
    { idx: -1, start: new Date(start.getTime() - HOUR_MS), end: new Date(start.getTime() - 1) },
  ];
}

async function readA(fleet: pg.Pool, fx: SegmentViewsReadFixture) {
  return segmentWindowReads(fleet, {
    level: "5m",
    pointKey: "kw",
    assetIds: [fx.assetA, fx.assetB],
    windows: windows(fx),
  });
}

async function currentA(fleet: pg.Pool, fx: SegmentViewsReadFixture) {
  const rows = await readA(fleet, fx);
  return rows.find((row) => row.assetId === fx.assetA && row.idx === 0) ?? fail("no current row for A");
}

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

/** A — the mean over two `_5m` rows of counts 3 and 1 is the weighted mean, 1.75. */
export async function assertTheMeanIsWeighted(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  const row = await currentA(fleet, fx);
  expect(row.mean).toBeCloseTo(7 / 4, 9);
  expect(row.sampleCount).toBe(4);
}

/** A — `max` is `max(max_value)` with the bucket it fell in. */
export async function assertTheMaxAndItsBucket(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  const row = await currentA(fleet, fx);
  expect(row.max).toBe(4);
  expect(row.maxAt).toBe(new Date(fx.hour.getTime() + 5 * MINUTE_MS).toISOString());
}

/** A — `bucket_count` counts distinct buckets: two `_5m` rows. */
export async function assertTheBucketCountIsDistinct(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  expect((await currentA(fleet, fx)).bucketCount).toBe(2);
}

/** A — the compare window is its own row (`idx −1`), and an asset outside the list reaches no row. */
export async function assertTheCompareRowAndTheAssetBound(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  const rows = await readA(fleet, fx);
  expect(rows.find((row) => row.assetId === fx.assetA && row.idx === -1)?.mean).toBe(COMPARE_KW);
  expect(rows.filter((row) => row.assetId === fx.assetC)).toEqual([]);
  expect(rows.filter((row) => row.max === FOREIGN_KW)).toEqual([]);
}

/** B — a `1d` bucket over `_1h` in `Asia/Kolkata` puts the 20:10Z sample on the next local day (18:30Z), and the day before is a gap. */
export async function assertADayBucketIsALocalDay(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  const start = new Date(fx.bAt.getTime() - 2 * DAY_MS);
  const end = new Date(fx.bAt.getTime() + 2 * HOUR_MS);
  const rows = await segmentSeriesRead(fleet, {
    level: "1h",
    bucket: "1d",
    timeZone: KOLKATA.arithmeticZone,
    pointKey: "kw",
    assetIds: [fx.assetB],
    current: { start, end },
    compare: null,
  });
  const localMidnight = `${fx.bAt.toISOString().slice(0, 10)}T18:30:00.000Z`;
  expect(rows.map((row) => [row.t, row.v])).toEqual([[localMidnight, B_KW]]);
  const filled = fillSeries(rows, { start, end, durationHours: 50 }, "1h", "1d", KOLKATA);
  expect(filled.at(-1)).toEqual({ t: localMidnight, v: B_KW });
  expect(filled.at(-2)?.v).toBeNull();
}

/** B — the current and the compare series in one statement; the compare bucket keeps its true timestamp. */
export async function assertCompareBucketsKeepTheirTimestamps(fleet: pg.Pool, fx: SegmentViewsReadFixture): Promise<void> {
  const [current, compare] = windows(fx);
  const rows = await segmentSeriesRead(fleet, {
    level: "5m",
    bucket: "5m",
    timeZone: KOLKATA.arithmeticZone,
    pointKey: "kw",
    assetIds: [fx.assetA],
    current: current ?? fail("no window"),
    compare: compare ?? fail("no window"),
  });
  expect(rows.map((row) => [row.idx, row.t, row.v])).toEqual([
    [-1, new Date(fx.hour.getTime() - 30 * MINUTE_MS).toISOString(), COMPARE_KW],
    [0, fx.hour.toISOString(), 1],
    [0, new Date(fx.hour.getTime() + 5 * MINUTE_MS).toISOString(), 4],
  ]);
}

// ---------------------------------------------------------------------------
// Statement shape, through a recording pool (no database)
// ---------------------------------------------------------------------------

const IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const NOW = new Date("2026-10-15T10:47:13.250Z");
const SHAPE_WINDOWS = [
  { idx: 0, start: new Date(NOW.getTime() - DAY_MS), end: NOW },
  { idx: 1, start: new Date(NOW.getTime() - 2 * DAY_MS), end: new Date(NOW.getTime() - DAY_MS) },
];

/** A binds the point as `$4` and the list as `$5`, with no `IS NULL OR` and no literal point. */
export async function assertStatementABindsThePointAndTheList(): Promise<void> {
  const { pool, statements } = recordingPool();
  await segmentWindowReads(pool, { level: "5m", pointKey: "pf", assetIds: IDS, windows: SHAPE_WINDOWS });
  expect(statements).toHaveLength(1);
  const { text, params } = statements[0] ?? fail("no statement");
  expect(text).toContain("v.point_key = $4::text");
  expect(text).toContain("v.asset_id = ANY($5::uuid[])");
  expect(text).not.toMatch(/IS NULL OR/i);
  expect(text).not.toMatch(/point_key\s*=\s*'/);
  expect(params[3]).toBe("pf");
  expect(params[4]).toEqual(IDS);
  expect(params[0]).toEqual([0, 1]);
}

/** A's relation is `aggregateRelation(level)`: `_5m` at `5m`, `_1h` at `1h`, never raw. */
export async function assertStatementAReadsTheLevelsRelation(): Promise<void> {
  for (const [level, relation] of [
    ["5m", "telemetry.point_values_5m"],
    ["1h", "telemetry.point_values_1h"],
  ] as const) {
    const { pool, statements } = recordingPool();
    await segmentWindowReads(pool, { level, pointKey: "kw", assetIds: IDS, windows: SHAPE_WINDOWS });
    expect(statements[0]?.text).toContain(relation);
    expect(statements[0]?.text).not.toMatch(/telemetry\.point_values(?!_)/);
  }
}

/** B binds the asset list as `unnest($1::uuid[])`, both windows and the point; the zone only for a `1d` bucket. */
export async function assertStatementBBindsThePairs(): Promise<void> {
  const { pool, statements } = recordingPool();
  const current = { start: new Date(NOW.getTime() - DAY_MS), end: NOW };
  await segmentSeriesRead(pool, {
    level: "5m",
    bucket: "5m",
    timeZone: "Asia/Kolkata",
    pointKey: "pf",
    assetIds: IDS,
    current,
    compare: null,
  });
  await segmentSeriesRead(pool, {
    level: "1h",
    bucket: "1d",
    timeZone: "Asia/Kolkata",
    pointKey: "pf",
    assetIds: IDS,
    current,
    compare: null,
  });
  const [level, day] = statements;
  expect(level?.text).toContain("unnest($1::uuid[])");
  expect(level?.text).not.toMatch(/IS NULL OR/i);
  expect(level?.params).toEqual([IDS, current.start.toISOString(), NOW.toISOString(), null, null, "pf"]);
  expect(day?.text).toContain("time_bucket(INTERVAL '1 day', agg.bucket, $7::text)");
  expect(day?.params[6]).toBe("Asia/Kolkata");
}

/** An empty asset list sends neither statement (paired with the database cases). */
export async function assertAnEmptyListSendsNoStatement(): Promise<void> {
  const { pool, statements } = recordingPool();
  expect(await segmentWindowReads(pool, { level: "5m", pointKey: "kw", assetIds: [], windows: SHAPE_WINDOWS })).toEqual([]);
  const current = { start: new Date(NOW.getTime() - DAY_MS), end: NOW };
  expect(
    await segmentSeriesRead(pool, {
      level: "5m",
      bucket: "5m",
      timeZone: "Asia/Kolkata",
      pointKey: "kw",
      assetIds: [],
      current,
      compare: null,
    }),
  ).toEqual([]);
  expect(statements).toEqual([]);
}
