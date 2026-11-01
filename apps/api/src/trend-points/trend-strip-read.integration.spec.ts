import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import type pg from "pg";
import { expect } from "vitest";

import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { recordingPool } from "../testing/recording-pool";
import { trendStripRead } from "./trend-strip-read";
import { type StripPlan, type StripWindow, groupSeries, stripWindow } from "./trend-strip.pure";

/**
 * `F4.301` U2 (ADR 0108 Amendment 2, items 4 and 5) — the trend strip's one
 * telemetry statement against the real `_5m` continuous aggregate, and its
 * shape through a recording pool. Vitest entry point: the sibling `.test.ts`,
 * which owns the pools and the fixture lifecycle.
 *
 * ## The fixture
 *
 * One organization this run creates, with three assets coded with a
 * `randomUUID` part. `kw` samples, placed against the 24 h window aligned at
 * setup (`fx.window`, reused by every case so a fold boundary crossed during
 * the run moves nothing):
 *
 * - asset A, fold {@link FOLD_A} (a complete 30-minute fold 90 minutes before
 *   `to`): **1, 1, 1 in its first 5-minute bucket and 4 in its second**, so the
 *   two `_5m` rows carry `sample_count` 3 and 1. The weighted mean is
 *   7 / 4 = 1.75; a mean of the rows' means is (1 + 4) / 2 = 2.5. One `_5m`
 *   row, or equal counts, would give 1.75 under both forms and the case could
 *   not go red (the `assertCoarseRollupFromFinerLevel` lesson).
 * - asset B, fold {@link FOLD_B}: one sample of 7.
 * - asset C, outside every pair: 1 000 at A's instants, so a read that drops
 *   the pair join takes it in and reddens.
 *
 * Committed, not rolled back: a continuous aggregate refresh cannot see an
 * uncommitted row. Cleanup deletes telemetry by these asset ids, re-refreshes,
 * then deletes the organization (the `energy-view-read.integration.spec.ts`
 * reasoning).
 */

const MINUTE_MS = 60_000;
const FOLD_MS = 30 * MINUTE_MS;
const FOLD_A = 45;
const FOLD_B = 10;
const WEIGHTED_MEAN = 7 / 4;
const FOREIGN_KW = 1_000;
const B_KW = 7;

export interface TrendStripReadFixture {
  readonly assetA: string;
  readonly assetB: string;
  readonly assetC: string;
  readonly organizationId: string;
  readonly window: StripWindow;
}

function fail(message: string): never {
  throw new Error(message);
}

async function dropOrganization(superuser: pg.Pool, organizationId: string): Promise<void> {
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = $1`, [organizationId]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [organizationId]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = $1`, [organizationId]);
}

/**
 * Builds the organization and its assets (superuser: `bms.assets` is
 * FORCE-policied), writes the telemetry and refreshes the aggregates (owner).
 * Cleans up before rethrowing on failure.
 */
export async function setUpTrendStripReadFixture(superuser: pg.Pool, owner: pg.Pool): Promise<TrendStripReadFixture> {
  const run = randomUUID().slice(0, 8).toUpperCase();
  const code = `TSR-${run}`;
  const window = stripWindow("24h", new Date());
  const { rows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [code, `F4.301 trend strip read ${code}`],
  );
  const organizationId = rows[0]?.id ?? fail(`organization ${code} was not inserted`);
  try {
    const { rows: loc } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, NULL) RETURNING id`,
      [organizationId, `${code}-L`, `${code}-l`.toLowerCase(), `F4.301 ${code} site`],
    );
    const locationId = loc[0]?.id ?? fail(`location of ${code} was not inserted`);
    const asset = async (suffix: string): Promise<string> => {
      const { rows: a } = await superuser.query<{ id: string }>(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $3, 'F4.301 trend strip read',
                 (SELECT code FROM bms.asset_domains ORDER BY created_at, code LIMIT 1))
         RETURNING id`,
        [organizationId, locationId, `${code}-${suffix}`],
      );
      return a[0]?.id ?? fail(`asset ${suffix} was not inserted`);
    };
    const fx: TrendStripReadFixture = {
      assetA: await asset("A"),
      assetB: await asset("B"),
      assetC: await asset("C"),
      organizationId,
      window,
    };

    const times: string[] = [];
    const ids: string[] = [];
    const values: number[] = [];
    const sample = (id: string, fold: number, minute: number, value: number): void => {
      times.push(new Date(window.from.getTime() + fold * FOLD_MS + minute * MINUTE_MS).toISOString());
      ids.push(id);
      values.push(value);
    };
    for (const minute of [1, 2, 3]) {
      sample(fx.assetA, FOLD_A, minute, 1);
      sample(fx.assetC, FOLD_A, minute, FOREIGN_KW);
    }
    sample(fx.assetA, FOLD_A, 6, 4);
    sample(fx.assetC, FOLD_A, 6, FOREIGN_KW);
    sample(fx.assetB, FOLD_B, 1, B_KW);

    try {
      await owner.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         SELECT t, a::uuid, 'kw', v, 'kW'
         FROM unnest($1::timestamptz[], $2::uuid[], $3::float8[]) AS x(t, a, v)`,
        [times, ids, values],
      );
      await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, window.from));
    } catch (err) {
      await cleanupTrendStripReadFixture(superuser, owner, fx);
      throw err;
    }
    return fx;
  } catch (err) {
    await dropOrganization(superuser, organizationId).catch(() => undefined);
    throw err;
  }
}

/** Deletes this run's telemetry by asset id, re-refreshes, then the organization. Warns, never throws. */
export async function cleanupTrendStripReadFixture(
  superuser: pg.Pool,
  owner: pg.Pool,
  fx: TrendStripReadFixture,
): Promise<void> {
  try {
    for (const id of [fx.assetA, fx.assetB, fx.assetC]) {
      await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = 'kw'`, [id]);
    }
    await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, fx.window.from));
    await dropOrganization(superuser, fx.organizationId);
  } catch (err: unknown) {
    process.stderr.write(
      `\n[F4.301] WARNING: trend strip read fixture cleanup failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Leftover rows may remain. Repair the aggregates with: pnpm db:refresh-aggregates\n\n",
    );
  }
}

function pairs(fx: TrendStripReadFixture): { assetId: string; pointKey: string }[] {
  return [
    { assetId: fx.assetA, pointKey: "kw" },
    { assetId: fx.assetB, pointKey: "kw" },
  ];
}

/** A one-segment plan over A and B, so `groupSeries` gap-fills the read. */
function planOf(fx: TrendStripReadFixture): StripPlan {
  return {
    assetsPerPoint: 6,
    pointsPerSegment: 1,
    trimmed: false,
    segments: [
      {
        domain: "fixture",
        label: "Fixture",
        source: "catalog",
        points: [
          {
            code: "kw",
            name: "kW",
            unit: "kW",
            moreAssets: 0,
            assets: [fx.assetA, fx.assetB].map((assetId, i) => ({
              assetId,
              assetCode: `A${i}`,
              assetName: `A${i}`,
              unit: "kW",
            })),
          },
        ],
      },
    ],
  };
}

async function read(fleet: pg.Pool, fx: TrendStripReadFixture) {
  const w = fx.window;
  return trendStripRead(fleet, { level: w.level, bucketSeconds: w.bucketSeconds, from: w.from, to: w.to, pairs: pairs(fx) });
}

async function series(fleet: pg.Pool, fx: TrendStripReadFixture) {
  const segments = groupSeries(planOf(fx), await read(fleet, fx), fx.window);
  return segments[0]?.points[0]?.assets ?? fail("no series");
}

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

/** R1 — two pairs over 24 h: exactly 48 buckets each after gap-fill. */
export async function assertTwoPairsReturnFortyEightBucketsEach(fleet: pg.Pool, fx: TrendStripReadFixture): Promise<void> {
  const assets = await series(fleet, fx);
  expect(assets.map((a) => a.buckets.length)).toEqual([48, 48]);
}

/** R1 — the first bucket starts at the aligned `from`. */
export async function assertTheFirstBucketIsFrom(fleet: pg.Pool, fx: TrendStripReadFixture): Promise<void> {
  const assets = await series(fleet, fx);
  expect(assets[0]?.buckets[0]?.t).toBe(fx.window.from.toISOString());
}

/** R1 — a fold with no sample is `null`, beside a fold that has one. */
export async function assertAFoldWithNoSampleIsNull(fleet: pg.Pool, fx: TrendStripReadFixture): Promise<void> {
  const assets = await series(fleet, fx);
  const b = assets[1] ?? fail("no B series");
  expect(b.buckets[FOLD_B]?.v).toBe(B_KW);
  expect(b.buckets[FOLD_B + 1]?.v).toBeNull();
}

/** R2 — the 30-minute fold over two `_5m` rows (counts 3 and 1) is the weighted mean, 1.75. */
export async function assertTheFoldIsTheWeightedMean(fleet: pg.Pool, fx: TrendStripReadFixture): Promise<void> {
  const assets = await series(fleet, fx);
  expect(assets[0]?.buckets[FOLD_A]?.v).toBeCloseTo(WEIGHTED_MEAN, 9);
}

/** R3 — an asset with samples that is not in the pairs reaches no row (paired with R1). */
export async function assertAnAssetOutsideThePairsChangesNothing(fleet: pg.Pool, fx: TrendStripReadFixture): Promise<void> {
  const rows = await read(fleet, fx);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.filter((row) => row.assetId === fx.assetC)).toEqual([]);
  expect(rows.filter((row) => row.v === FOREIGN_KW)).toEqual([]);
}

// ---------------------------------------------------------------------------
// Statement shape, through a recording pool (no database)
// ---------------------------------------------------------------------------

const PAIRS = [
  { assetId: "00000000-0000-4000-8000-000000000001", pointKey: "kw" },
  { assetId: "00000000-0000-4000-8000-000000000002", pointKey: "pf" },
];
const NOW = new Date("2026-10-15T10:47:13.250Z");

async function statementFor(range: "24h" | "7d") {
  const { pool, statements } = recordingPool();
  const w = stripWindow(range, NOW);
  await trendStripRead(pool, { level: w.level, bucketSeconds: w.bucketSeconds, from: w.from, to: w.to, pairs: PAIRS });
  expect(statements).toHaveLength(1);
  return statements[0] ?? fail("no statement recorded");
}

/** R4 — the pairs are bound as arrays and joined, with no nullable leg. */
export async function assertThePairsAreBoundAsArrays(): Promise<void> {
  const { text, params } = await statementFor("24h");
  expect(text).toContain("unnest($1::uuid[])");
  expect(text).toContain("unnest($2::text[])");
  expect(text).not.toMatch(/IS NULL OR/i);
  expect(params[0]).toEqual(PAIRS.map((p) => p.assetId));
  expect(params[1]).toEqual(PAIRS.map((p) => p.pointKey));
}

/** R4 — 24 h reads `_5m`, never raw. */
export async function assertTheDayReadsTheFiveMinuteRelation(): Promise<void> {
  const { text } = await statementFor("24h");
  expect(text).toContain("telemetry.point_values_5m");
  expect(text).not.toMatch(/telemetry\.point_values(?!_)/);
}

/** R4 — 7 d reads `_1h`, never raw. */
export async function assertTheWeekReadsTheHourRelation(): Promise<void> {
  const { text } = await statementFor("7d");
  expect(text).toContain("telemetry.point_values_1h");
  expect(text).not.toMatch(/telemetry\.point_values(?!_)/);
}

/** R5 — an empty pair list returns `[]` and sends no statement (paired with R1). */
export async function assertAnEmptyPairListSendsNoStatement(): Promise<void> {
  const { pool, statements } = recordingPool();
  const w = stripWindow("24h", NOW);
  const rows = await trendStripRead(pool, { level: w.level, bucketSeconds: w.bucketSeconds, from: w.from, to: w.to, pairs: [] });
  expect(rows).toEqual([]);
  expect(statements).toEqual([]);
}
