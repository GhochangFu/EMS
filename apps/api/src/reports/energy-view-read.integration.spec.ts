import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import type pg from "pg";
import { expect } from "vitest";

import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import { previousPeriod } from "./energy-view-range";
import { averagePf, energyPeriodRead, topConsumersRead, viewTopConsumers } from "./energy-view-read";
import { ReportsService } from "./reports.service";

/**
 * `F4.298` U3 (ADR 0108 decisions 2.4, 2.5 and 2.10) — the energy view's SQL
 * reads against a real continuous aggregate, and their statement shape against
 * a recording pool. Vitest entry point: the sibling `.test.ts`, which owns the
 * pools and the fixture lifecycle.
 *
 * ## The fixture
 *
 * Two organizations this run creates. Organization A holds a grid asset and a
 * `PV`-coded asset (the existing `code ILIKE 'PV%'` solar rule); organization B
 * holds one foreign asset with `kw` and `pf` samples in the same hours, so a read
 * that drops its asset filter takes the foreign figures in and reddens.
 *
 * Twenty-six `_1h` buckets, one `kw` sample each per asset, around one
 * `Asia/Kolkata` day: bucket 0 is `18:00Z` of day D (23:30 local, the previous
 * local day), buckets 1–24 are `19:00Z` D to `18:00Z` D+1 (the local day that
 * starts `18:30Z` D), bucket 25 is `19:00Z` D+1 (the next local day). Day D is
 * two UTC days back, so every bucket is complete before `now` and inside every
 * level's retention.
 *
 * Committed, not rolled back: a continuous aggregate refresh cannot see an
 * uncommitted row. Every row carries this run's own ids (fresh organizations,
 * assets coded with a `randomUUID` part), and cleanup deletes telemetry by those
 * asset ids, re-refreshes, then deletes the organizations — so a concurrent
 * instance of this file never touches this run's rows, and no orphan aggregate
 * bucket outlives the run (the `reports.service.rls.integration.spec.ts`
 * reasoning).
 */

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const BUCKETS = 26;
const SPIKE_BUCKET = 9;
const SPIKE_KW = 500;
const PV_KW = 5;
const FOREIGN_KW = 1_000;
const NO_TARIFFS = { resolveForAssets: async () => new Map<string, number>() };

/** The grid asset's `kw` in bucket `k`: rising, with one spike. */
function gridKw(k: number): number {
  return k === SPIKE_BUCKET ? SPIKE_KW : 10 + k;
}

/** Organization A's summed kW in bucket `k`. */
function totalKw(k: number): number {
  return gridKw(k) + PV_KW;
}

/** Σ over buckets `from..to` (inclusive) of organization A's kW — kWh at `_1h`. */
function sumKw(from: number, to: number): number {
  let sum = 0;
  for (let k = from; k <= to; k += 1) sum += totalKw(k);
  return sum;
}

/** `pf` samples: `[asset, bucket, values]`. Sample-weighted A: (3 × 0.9 + 0.5 + 1.0) / 5 = 0.84. */
const PF_A_MEAN = (0.9 * 3 + 0.5 + 1.0) / 5;
const FOREIGN_PF = 0.1;

export interface EnergyViewReadFixture {
  readonly gridAssetId: string;
  readonly pvAssetId: string;
  readonly foreignAssetId: string;
  /** `18:30Z` of day D: the start of the fixture's `Asia/Kolkata` day. */
  readonly localDayStart: Date;
  readonly organizationIds: readonly string[];
  readonly refreshFrom: Date;
}

/** The start of `_1h` bucket `k` of the fixture. */
function bucketStart(fx: EnergyViewReadFixture, k: number): Date {
  return new Date(fx.localDayStart.getTime() - 30 * MINUTE_MS + k * HOUR_MS);
}

function scope(fx: EnergyViewReadFixture): string[] {
  return [fx.gridAssetId, fx.pvAssetId];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fail(message: string): never {
  throw new Error(message);
}

/** The UTC calendar date of day D + `offset`, as `YYYY-MM-DD`. */
function utcDate(fx: EnergyViewReadFixture, offset: number): string {
  const midnight = Date.UTC(
    fx.localDayStart.getUTCFullYear(),
    fx.localDayStart.getUTCMonth(),
    fx.localDayStart.getUTCDate() + offset,
  );
  return new Date(midnight).toISOString().slice(0, 10);
}

async function dropOrganizations(superuser: pg.Pool, organizationIds: readonly string[]): Promise<void> {
  for (const id of organizationIds) {
    await superuser.query(`DELETE FROM bms.assets WHERE organization_id = $1`, [id]);
    await superuser.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [id]);
    await superuser.query(`DELETE FROM bms.organizations WHERE id = $1`, [id]);
  }
}

/**
 * Builds the two organizations and their assets (superuser: `bms.assets` is
 * FORCE-policied), writes the telemetry and refreshes the aggregates (owner, the
 * `refreshAggregatesFrom` role path). Cleans up before rethrowing on failure.
 */
export async function setUpEnergyViewReadFixture(
  superuser: pg.Pool,
  owner: pg.Pool,
): Promise<EnergyViewReadFixture> {
  const run = randomUUID().slice(0, 8).toUpperCase();
  const organizationIds: string[] = [];
  const now = new Date();
  const localDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 18, 30));
  const refreshFrom = new Date(localDayStart.getTime() - 2 * HOUR_MS);

  const organization = async (suffix: string): Promise<{ organizationId: string; locationId: string }> => {
    const code = `EVR-${run}-${suffix}`;
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
      [code, `F4.298 energy view read ${code}`],
    );
    const organizationId = rows[0]?.id ?? fail(`organization ${code} was not inserted`);
    organizationIds.push(organizationId);
    const { rows: loc } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, NULL) RETURNING id`,
      [organizationId, `${code}-L`, `${code}-l`.toLowerCase(), `F4.298 ${code} site`],
    );
    return { organizationId, locationId: loc[0]?.id ?? fail(`location of ${code} was not inserted`) };
  };
  const asset = async (place: { organizationId: string; locationId: string }, code: string): Promise<string> => {
    const { rows } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $3, 'F4.298 energy view read', (SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1))
       RETURNING id`,
      [place.organizationId, place.locationId, code],
    );
    return rows[0]?.id ?? fail(`asset ${code} was not inserted`);
  };

  try {
    const a = await organization("A");
    const b = await organization("B");
    const gridAssetId = await asset(a, `EVR-${run}-GRID`);
    const pvAssetId = await asset(a, `PV-EVR-${run}`);
    const foreignAssetId = await asset(b, `EVR-${run}-FOREIGN`);
    const fx: EnergyViewReadFixture = {
      gridAssetId,
      pvAssetId,
      foreignAssetId,
      localDayStart,
      organizationIds,
      refreshFrom,
    };

    const times: string[] = [];
    const ids: string[] = [];
    const keys: string[] = [];
    const values: number[] = [];
    const sample = (id: string, k: number, minute: number, key: string, value: number): void => {
      times.push(new Date(bucketStart(fx, k).getTime() + minute * MINUTE_MS).toISOString());
      ids.push(id);
      keys.push(key);
      values.push(value);
    };
    for (let k = 0; k < BUCKETS; k += 1) {
      sample(gridAssetId, k, 10, "kw", gridKw(k));
      sample(pvAssetId, k, 10, "kw", PV_KW);
      sample(foreignAssetId, k, 10, "kw", FOREIGN_KW);
    }
    for (const minute of [20, 21, 22]) sample(gridAssetId, 3, minute, "pf", 0.9);
    sample(gridAssetId, 4, 20, "pf", 0.5);
    sample(pvAssetId, 5, 20, "pf", 1.0);
    for (const minute of [20, 21, 22, 23, 24]) sample(foreignAssetId, 3, minute, "pf", FOREIGN_PF);

    try {
      await owner.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         SELECT t, a::uuid, k, v, CASE WHEN k = 'kw' THEN 'kW' ELSE 'PF' END
         FROM unnest($1::timestamptz[], $2::uuid[], $3::text[], $4::float8[]) AS x(t, a, k, v)`,
        [times, ids, keys, values],
      );
      await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, refreshFrom));
    } catch (err) {
      await cleanupEnergyViewReadFixture(superuser, owner, fx);
      throw err;
    }
    return fx;
  } catch (err) {
    await dropOrganizations(superuser, organizationIds).catch(() => undefined);
    throw err;
  }
}

/**
 * Deletes this run's telemetry by asset id (constant `asset_id` / `point_key`
 * filters: the `0028` SEGMENTBY rule), re-refreshes so no orphan aggregate
 * bucket survives, then deletes the organizations. Warns, never throws.
 */
export async function cleanupEnergyViewReadFixture(
  superuser: pg.Pool,
  owner: pg.Pool,
  fx: EnergyViewReadFixture,
): Promise<void> {
  try {
    for (const id of [fx.gridAssetId, fx.pvAssetId, fx.foreignAssetId]) {
      for (const key of ["kw", "pf"]) {
        await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2`, [id, key]);
      }
    }
    await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, fx.refreshFrom));
    await dropOrganizations(superuser, fx.organizationIds);
  } catch (err: unknown) {
    process.stderr.write(
      `\n[F4.298] WARNING: energy view read fixture cleanup failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Leftover rows may remain. Repair the aggregates with: pnpm db:refresh-aggregates\n\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

/** Case 1 — over one UTC day the read's kWh equals the preview's, for the same ids. */
export async function assertTotalKwhMatchesThePreview(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const day = utcDate(fx, 1);
  const preview = await new ReportsService(fleet, NO_TARIFFS).energyPreview({ startDate: day, endDate: day }, scope(fx));
  const read = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
    assetIds: scope(fx),
  });
  // Buckets 6–25 are 00:00Z to 19:00Z of D + 1: the positive control that the day holds data.
  expect(read.totalKwh).toBeCloseTo(sumKw(6, 25), 6);
  expect(round2(read.totalKwh)).toBe(preview.summary.totalKwh);
  expect(round2(read.solarKwh)).toBe(preview.sourceTotals.solarKwh);
  expect(read.solarKwh).toBeCloseTo(20 * PV_KW, 6);
}

/** Case 2 — `peakAt` is the `_1h` bucket that holds the spike; `peakKw` its summed kW. */
export async function assertThePeakIsTheSpikeBucket(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const read = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    start: bucketStart(fx, 0),
    end: bucketStart(fx, BUCKETS - 1),
    assetIds: scope(fx),
  });
  expect(read.peakAt).toBe(bucketStart(fx, SPIKE_BUCKET).toISOString());
  expect(read.peakKw).toBeCloseTo(SPIKE_KW + PV_KW, 6);
  expect(read.hasData).toBe(true);
}

/** Case 3 — the sample-weighted mean of the `pf` samples across two assets. */
export async function assertAveragePfIsSampleWeighted(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const pf = await averagePf(fleet, {
    level: "1h",
    start: bucketStart(fx, 0),
    end: bucketStart(fx, BUCKETS - 1),
    assetIds: scope(fx),
  });
  // The bucket mean of means would be (0.9 + 0.5 + 1.0) / 3 = 0.8.
  expect(pf).toBeCloseTo(PF_A_MEAN, 10);
}

/** Case 3 — `null` when the scope has `kw` but no `pf` row in the period. */
export async function assertAveragePfIsNullWithNoPfRow(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { start: bucketStart(fx, 10), end: bucketStart(fx, 12) };
  const pf = await averagePf(fleet, { level: "1h", ...window, assetIds: scope(fx) });
  expect(pf).toBeNull();
  const kw = await energyPeriodRead(fleet, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", ...window, assetIds: scope(fx) });
  expect(kw.hasData).toBe(true);
}

/** Case 4 — the compare period of `[s, e]` reads no bucket at or after `s`. */
export async function assertTheComparePeriodStopsBeforeTheStart(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const current = { start: bucketStart(fx, 12), end: bucketStart(fx, 20), durationHours: 8 };
  const compare = previousPeriod(current);
  const read = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    start: compare.start,
    end: compare.end,
    assetIds: scope(fx),
  });
  expect(read.series.map((p) => p.t)).toEqual(
    Array.from({ length: 8 }, (_, i) => bucketStart(fx, 4 + i).toISOString()),
  );
  expect(read.totalKwh).toBeCloseTo(sumKw(4, 11), 6);
}

/** Case 4 — an empty period has no data, zero totals and no peak time. */
export async function assertAnEmptyPeriodHasNoData(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const start = new Date(bucketStart(fx, 0).getTime() - 10 * 24 * HOUR_MS);
  const read = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    start,
    end: new Date(start.getTime() + 24 * HOUR_MS),
    assetIds: scope(fx),
  });
  expect(read).toEqual({ series: [], totalKwh: 0, solarKwh: 0, peakKw: 0, peakAt: null, hasData: false });
}

/** Case 5 — a `1d` bucket in `Asia/Kolkata` is the local day over `_1h`. */
export async function assertADayBucketIsTheLocalDay(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const read = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1d",
    timeZone: "Asia/Kolkata",
    start: bucketStart(fx, 0),
    end: bucketStart(fx, BUCKETS - 1),
    assetIds: scope(fx),
  });
  const day = fx.localDayStart.getTime();
  expect(read.series.map((p) => p.t)).toEqual([
    new Date(day - 24 * HOUR_MS).toISOString(),
    new Date(day).toISOString(),
    new Date(day + 24 * HOUR_MS).toISOString(),
  ]);
  const kw = (i: number): number => {
    const p = read.series[i] ?? fail(`no series point ${i}`);
    return p.gridKw + p.solarKw + p.dgKw;
  };
  // The point is the mean kW of the day's 24 read buckets: × 24 h is the day's kWh.
  expect(kw(1) * 24).toBeCloseTo(sumKw(1, 24), 0);
  expect(kw(1)).toBeCloseTo(sumKw(1, 24) / 24, 1);
  // The boundary buckets fall into the neighbouring local days.
  expect(kw(0)).toBeCloseTo(totalKw(0), 1);
  expect(kw(2)).toBeCloseTo(totalKw(BUCKETS - 1), 1);
  expect(read.totalKwh).toBeCloseTo(sumKw(0, BUCKETS - 1), 6);
}

/** Case 6 — the foreign asset changes nothing in `energyPeriodRead`; positive control on its own id. */
export async function assertTheForeignAssetIsOutsideThePeriodRead(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", bucket: "1h", timeZone: "Etc/UTC", start: bucketStart(fx, 0), end: bucketStart(fx, BUCKETS - 1) } as const;
  const scoped = await energyPeriodRead(fleet, { ...window, assetIds: scope(fx) });
  expect(scoped.totalKwh).toBeCloseTo(sumKw(0, BUCKETS - 1), 6);
  expect(scoped.peakKw).toBeCloseTo(SPIKE_KW + PV_KW, 6);
  expect(scoped.series).toHaveLength(BUCKETS);
  expect(Math.max(...scoped.series.map((p) => p.gridKw + p.solarKw + p.dgKw))).toBeLessThan(FOREIGN_KW);
  const foreign = await energyPeriodRead(fleet, { ...window, assetIds: [fx.foreignAssetId] });
  expect(foreign.peakKw).toBeCloseTo(FOREIGN_KW, 6);
}

/** Case 6 — the foreign asset's `pf` changes nothing in `averagePf`. */
export async function assertTheForeignAssetIsOutsideAveragePf(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", start: bucketStart(fx, 0), end: bucketStart(fx, BUCKETS - 1) } as const;
  expect(await averagePf(fleet, { ...window, assetIds: scope(fx) })).toBeCloseTo(PF_A_MEAN, 10);
  expect(await averagePf(fleet, { ...window, assetIds: [fx.foreignAssetId] })).toBeCloseTo(FOREIGN_PF, 10);
}

/** Case 6 — the foreign asset is never listed by `viewTopConsumers`. */
export async function assertTheForeignAssetIsOutsideTopConsumers(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", start: bucketStart(fx, 0), end: bucketStart(fx, BUCKETS - 1), durationHours: 25, limit: 10 } as const;
  const scoped = await viewTopConsumers(fleet, { ...window, assetIds: scope(fx) });
  expect(scoped.map((c) => c.assetId).sort()).toEqual(scope(fx).sort());
  const foreign = await viewTopConsumers(fleet, { ...window, assetIds: [fx.foreignAssetId] });
  expect(foreign.map((c) => c.assetId)).toEqual([fx.foreignAssetId]);
}

/** Case 9 — the moved top-consumers read equals the preview's for the same range and ids. */
export async function assertTopConsumersMatchThePreview(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const day = utcDate(fx, 1);
  const preview = await new ReportsService(fleet, NO_TARIFFS).energyPreview({ startDate: day, endDate: day }, scope(fx));
  const read = await viewTopConsumers(fleet, {
    level: "1h",
    start: new Date(`${day}T00:00:00.000Z`),
    end: new Date(`${day}T23:59:59.999Z`),
    durationHours: preview.range.durationHours,
    limit: 10,
    assetIds: scope(fx),
  });
  expect(read).toHaveLength(2);
  expect(read).toEqual(preview.topConsumers);
}

// ---------------------------------------------------------------------------
// Statement shape, through a recording pool (no database)
// ---------------------------------------------------------------------------

type Recorded = { readonly text: string; readonly params: readonly unknown[] };

/** A `pg.Pool` stand-in that records every statement and answers no rows. */
function recordingPool(): { pool: pg.Pool; statements: Recorded[] } {
  const statements: Recorded[] = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      return { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;
  return { pool, statements };
}

const SCOPE = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const START = new Date("2026-10-01T00:00:00.000Z");
const END = new Date("2026-10-01T23:59:59.999Z");

function only(statements: readonly Recorded[]): Recorded {
  expect(statements).toHaveLength(1);
  return statements[0] ?? fail("no statement recorded");
}

/** Case 7 — `energyPeriodRead` binds the scope's list and carries no nullable leg. */
export async function assertThePeriodReadBindsTheList(): Promise<void> {
  const { pool, statements } = recordingPool();
  await energyPeriodRead(pool, { level: "5m", bucket: "5m", timeZone: "Etc/UTC", start: START, end: END, assetIds: SCOPE });
  const { text, params } = only(statements);
  expect(text).toMatch(/a\.id = ANY\(\$3::uuid\[\]\)/);
  expect(text).not.toMatch(/IS NULL OR/i);
  expect(params[2]).toEqual(SCOPE);
  expect(text).toContain("telemetry.point_values_5m");
}

/** Case 7 — `averagePf` binds the scope's list and carries no nullable leg. */
export async function assertAveragePfBindsTheList(): Promise<void> {
  const { pool, statements } = recordingPool();
  await averagePf(pool, { level: "1h", start: START, end: END, assetIds: SCOPE });
  const { text, params } = only(statements);
  expect(text).toMatch(/a\.id = ANY\(\$3::uuid\[\]\)/);
  expect(text).not.toMatch(/IS NULL OR/i);
  expect(params[2]).toEqual(SCOPE);
  expect(text).toContain("point_key = 'pf'");
}

/** Case 7 — `viewTopConsumers` sends the moved statement with `$4` bound to the list, never `null`. */
export async function assertViewTopConsumersBindsTheList(): Promise<void> {
  const view = recordingPool();
  await viewTopConsumers(view.pool, { level: "1h", start: START, end: END, durationHours: 24, limit: 10, assetIds: SCOPE });
  const sent = only(view.statements);
  expect(sent.params[3]).toEqual(SCOPE);
  const preview = recordingPool();
  await topConsumersRead(preview.pool, { level: "1h", start: START, end: END, durationHours: 24, limit: 10, assetIds: null });
  // The same moved statement; only the preview path binds `null`.
  expect(sent.text).toBe(only(preview.statements).text);
  expect(only(preview.statements).params[3]).toBeNull();
}

/** Case 5 — a `1d` bucket reads `_1h` and groups by the zone day; `_1d` is never named. */
export async function assertADayBucketNeverNamesTheUtcDayRelation(): Promise<void> {
  const { pool, statements } = recordingPool();
  await energyPeriodRead(pool, { level: "1h", bucket: "1d", timeZone: "Asia/Kolkata", start: START, end: END, assetIds: SCOPE });
  const { text, params } = only(statements);
  expect(text).toContain("telemetry.point_values_1h");
  expect(text).not.toContain("point_values_1d");
  expect(text).toMatch(/time_bucket\(INTERVAL '1 day', agg\.bucket, \$5::text\)/);
  expect(params[4]).toBe("Asia/Kolkata");
}

/** A read level that matches neither the bucket nor the zone-day rule is refused before any statement. */
export async function assertAnUnsupportedLevelAndBucketIsRefused(): Promise<void> {
  const { pool, statements } = recordingPool();
  await expect(
    energyPeriodRead(pool, { level: "1h", bucket: "5m", timeZone: "Etc/UTC", start: START, end: END, assetIds: SCOPE }),
  ).rejects.toThrow(/1h.*5m/);
  expect(statements).toHaveLength(0);
}

/** Case 8 — an empty scope returns the empty result and sends no statement, for each read. */
export async function assertAnEmptyScopeSendsNoStatement(): Promise<void> {
  const { pool, statements } = recordingPool();
  const read = await energyPeriodRead(pool, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: [] });
  expect(read).toEqual({ series: [], totalKwh: 0, solarKwh: 0, peakKw: 0, peakAt: null, hasData: false });
  expect(await averagePf(pool, { level: "1h", start: START, end: END, assetIds: [] })).toBeNull();
  expect(
    await viewTopConsumers(pool, { level: "1h", start: START, end: END, durationHours: 24, limit: 10, assetIds: [] }),
  ).toEqual([]);
  expect(statements).toHaveLength(0);
}

/** Case 8, paired — one id sends exactly one statement per read, so the absence above is not vacuous. */
export async function assertOneIdSendsOneStatementPerRead(): Promise<void> {
  const one = [SCOPE[0] ?? fail("no id")];
  const { pool, statements } = recordingPool();
  await energyPeriodRead(pool, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: one });
  expect(statements).toHaveLength(1);
  await averagePf(pool, { level: "1h", start: START, end: END, assetIds: one });
  expect(statements).toHaveLength(2);
  await viewTopConsumers(pool, { level: "1h", start: START, end: END, durationHours: 24, limit: 10, assetIds: one });
  expect(statements).toHaveLength(3);
}
