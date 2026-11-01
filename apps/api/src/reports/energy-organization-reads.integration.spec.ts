import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import type pg from "pg";
import { expect } from "vitest";

import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";
import {
  entityWindowReads,
  heatmapRead,
  siteEnergyRead,
  siteSeriesRead,
} from "./energy-organization-reads";
import {
  BUCKETS,
  FOREIGN_KW,
  PV_KW,
  SITE_TWO_KW,
  SPIKE_BUCKET,
  SPIKE_KW,
  bucketStart,
  gridKw,
  type EnergyViewReadFixture,
} from "./energy-view-read.integration.spec";
import { energyPeriodRead } from "./energy-view-read";

/**
 * `F4.299` U3 (ADR 0108 Amendment 1, 7.4–7.8) — the organization views' SQL
 * reads against a real continuous aggregate, and their statement shape against
 * a local recording pool. Vitest entry point: the sibling `.test.ts`, which owns
 * the pools and both fixtures' lifecycles.
 *
 * The main fixture is `setUpEnergyViewReadFixture` (`F4.298` U3): organization
 * A's first location holds the grid and `PV` assets, its second location the
 * fourth asset at `SITE_TWO_KW`; organization B holds the foreign asset at
 * `FOREIGN_KW`. Every claim here reads by inserted id (`F4.53`).
 *
 * The DST fixture ({@link setUpDstFixture}) is a second pass over the two most
 * recent `America/New_York` transitions before `now`: a fixed calendar date
 * would fall outside the raw relation's 730-day retention one day, and the
 * transition of the current day may not be complete.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function fail(message: string): never {
  throw new Error(message);
}

/** Organization A's three assets: both of its locations. */
function scopeA(fx: EnergyViewReadFixture): string[] {
  return [fx.gridAssetId, fx.pvAssetId, fx.siteTwoAssetId];
}

/** The first location's summed kW in bucket `k`. */
function siteOneKw(k: number): number {
  return gridKw(k) + PV_KW;
}

function sumOf(from: number, to: number, kw: (k: number) => number): number {
  let sum = 0;
  for (let k = from; k <= to; k += 1) sum += kw(k);
  return sum;
}

function wholeWindow(fx: EnergyViewReadFixture): { start: Date; end: Date } {
  return { start: bucketStart(fx, 0), end: bucketStart(fx, BUCKETS - 1) };
}

async function locationName(fleet: pg.Pool, id: string): Promise<string> {
  const { rows } = await fleet.query<{ name: string }>(`SELECT name FROM bms.locations WHERE id = $1`, [id]);
  return rows[0]?.name ?? fail(`location ${id} not found`);
}

// ---------------------------------------------------------------------------
// siteEnergyRead
// ---------------------------------------------------------------------------

/** 1 — Σ over the sites' kWh equals `energyPeriodRead`'s `totalKwh` for the same ids. */
export async function assertSiteKwhSumsToTheTotal(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = wholeWindow(fx);
  const { sites, totalSites } = await siteEnergyRead(fleet, { level: "1h", ...window, assetIds: scopeA(fx), limit: 50 });
  const period = await energyPeriodRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    ...window,
    assetIds: scopeA(fx),
  });
  expect(totalSites).toBe(2);
  expect(sites.reduce((sum, s) => sum + s.kwh, 0)).toBeCloseTo(period.totalKwh, 6);
  expect(period.totalKwh).toBeCloseTo(sumOf(0, BUCKETS - 1, siteOneKw) + BUCKETS * SITE_TWO_KW, 6);
}

/** 1 — the spike's site reports the spike bucket and its summed kW; the flat site its earliest bucket. */
export async function assertTheSpikeSiteReportsItsPeak(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const { sites } = await siteEnergyRead(fleet, { level: "1h", ...wholeWindow(fx), assetIds: scopeA(fx), limit: 50 });
  const one = sites.find((s) => s.locationId === fx.locationIds.a1) ?? fail("site a1 missing");
  const two = sites.find((s) => s.locationId === fx.locationIds.a2) ?? fail("site a2 missing");
  expect(one.peakAt).toBe(bucketStart(fx, SPIKE_BUCKET).toISOString());
  expect(one.peakKw).toBeCloseTo(SPIKE_KW + PV_KW, 6);
  // Every bucket ties at `SITE_TWO_KW`: the earliest wins.
  expect(two.peakAt).toBe(bucketStart(fx, 0).toISOString());
  expect(two.peakKw).toBeCloseTo(SITE_TWO_KW, 6);
}

/** 1 — `assetCount` counts the assets with data at each site, in kWh order. */
export async function assertSitesCarryTheirAssetCount(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const { sites } = await siteEnergyRead(fleet, { level: "1h", ...wholeWindow(fx), assetIds: scopeA(fx), limit: 50 });
  expect(sites.map((s) => [s.locationId, s.assetCount])).toEqual([
    [fx.locationIds.a1, 2],
    [fx.locationIds.a2, 1],
  ]);
}

/** 1 — the name is `bms.locations.name`, never the assets' denormalised `site_name`. */
export async function assertTheSiteNameIsTheLocationName(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const { sites } = await siteEnergyRead(fleet, { level: "1h", ...wholeWindow(fx), assetIds: scopeA(fx), limit: 50 });
  const expected = await locationName(fleet, fx.locationIds.a1);
  expect(expected).not.toBe("F4.298 energy view read");
  expect(sites.find((s) => s.locationId === fx.locationIds.a1)?.name).toBe(expected);
  expect(sites.find((s) => s.locationId === fx.locationIds.a2)?.name).toBe(await locationName(fleet, fx.locationIds.a2));
}

/** 1 — `limit: 1` sends the top site only and still counts both. */
export async function assertTheLimitCutsTheRowsNotTheCount(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const { sites, totalSites } = await siteEnergyRead(fleet, { level: "1h", ...wholeWindow(fx), assetIds: scopeA(fx), limit: 1 });
  expect(sites.map((s) => s.locationId)).toEqual([fx.locationIds.a1]);
  expect(totalSites).toBe(2);
}

/** 1 — `locationIds` (the compare path) returns only the named sites. */
export async function assertLocationIdsNarrowTheSites(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const { sites } = await siteEnergyRead(fleet, {
    level: "1h",
    ...wholeWindow(fx),
    assetIds: scopeA(fx),
    limit: 50,
    locationIds: [fx.locationIds.a2],
  });
  expect(sites.map((s) => s.locationId)).toEqual([fx.locationIds.a2]);
  expect(sites[0]?.kwh).toBeCloseTo(BUCKETS * SITE_TWO_KW, 6);
}

// ---------------------------------------------------------------------------
// siteSeriesRead
// ---------------------------------------------------------------------------

/** 2 — one point per display bucket, each `kw` aligned with the columns; no `other` with ≤ 8 sites. */
export async function assertTheSeriesIsOneAlignedGrid(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const trend = await siteSeriesRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    ...wholeWindow(fx),
    assetIds: scopeA(fx),
    siteLimit: 8,
  });
  expect(trend.columns).toEqual([
    { kind: "site", locationId: fx.locationIds.a1, name: await locationName(fleet, fx.locationIds.a1) },
    { kind: "site", locationId: fx.locationIds.a2, name: await locationName(fleet, fx.locationIds.a2) },
  ]);
  expect(trend.points).toHaveLength(BUCKETS);
  expect(trend.points.every((p) => p.kw.length === trend.columns.length)).toBe(true);
  expect(trend.points[SPIKE_BUCKET]?.t).toBe(bucketStart(fx, SPIKE_BUCKET).toISOString());
  expect(trend.points[SPIKE_BUCKET]?.kw[0]).toBeCloseTo(SPIKE_KW + PV_KW, 6);
  expect(trend.points[SPIKE_BUCKET]?.kw[1]).toBeCloseTo(SITE_TWO_KW, 6);
}

/** 2 — `siteLimit: 1` with two sites folds the second into `other`. */
export async function assertTheRestFoldIntoOther(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const trend = await siteSeriesRead(fleet, {
    level: "1h",
    bucket: "1h",
    timeZone: "Etc/UTC",
    ...wholeWindow(fx),
    assetIds: scopeA(fx),
    siteLimit: 1,
  });
  expect(trend.columns.map((c) => (c.kind === "site" ? c.locationId : "other"))).toEqual([fx.locationIds.a1, "other"]);
  expect(trend.points).toHaveLength(BUCKETS);
  for (const point of trend.points) {
    expect(point.kw[1]).toBeCloseTo(SITE_TWO_KW, 6);
  }
}

/** 2 — a `1d` bucket in `Asia/Kolkata` is the local day: the 24 buckets `19:00Z` D → `18:00Z` D+1 make one point. */
export async function assertADaySeriesPointIsTheLocalDay(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const trend = await siteSeriesRead(fleet, {
    level: "1h",
    bucket: "1d",
    timeZone: "Asia/Kolkata",
    ...wholeWindow(fx),
    assetIds: scopeA(fx),
    siteLimit: 8,
  });
  const day = fx.localDayStart.getTime();
  expect(trend.points.map((p) => p.t)).toEqual([
    new Date(day - DAY_MS).toISOString(),
    new Date(day).toISOString(),
    new Date(day + DAY_MS).toISOString(),
  ]);
  const middle = trend.points[1] ?? fail("no middle day");
  // The mean kW of the day's 24 read buckets, per site.
  expect(middle.kw[0]).toBeCloseTo(sumOf(1, 24, siteOneKw) / 24, 6);
  expect(middle.kw[1]).toBeCloseTo(SITE_TWO_KW, 6);
  expect(trend.points[0]?.kw[0]).toBeCloseTo(siteOneKw(0), 6);
}

// ---------------------------------------------------------------------------
// heatmapRead
// ---------------------------------------------------------------------------

function utcDateOf(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/** 3 — a `_1h` bucket at `10:00Z` is local hour 15 of its `Asia/Kolkata` day. */
export async function assertTheHeatmapHourIsTheLocalHour(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const cells = await heatmapRead(fleet, { level: "1h", timeZone: "Asia/Kolkata", ...wholeWindow(fx), assetIds: scopeA(fx) });
  // Bucket k starts at 18:00Z D + k h, so bucket 16 is 10:00Z of D + 1 (15:30 IST).
  const tenZ = bucketStart(fx, 16);
  expect(tenZ.getUTCHours()).toBe(10);
  const cell = cells.find((c) => c.day === utcDateOf(tenZ) && c.hour === 15) ?? fail("no hour-15 cell");
  expect(cell.kwh).toBeCloseTo(siteOneKw(16) + SITE_TWO_KW, 6);
  expect(cells.filter((c) => c.day === cell.day && c.hour === 15)).toHaveLength(1);
}

/** 3 — Σ cells equals `energyPeriodRead`'s `totalKwh` for the same ids. */
export async function assertTheHeatmapSumsToTheTotal(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = wholeWindow(fx);
  const cells = await heatmapRead(fleet, { level: "1h", timeZone: "Asia/Kolkata", ...window, assetIds: scopeA(fx) });
  const period = await energyPeriodRead(fleet, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", ...window, assetIds: scopeA(fx) });
  expect(cells).toHaveLength(BUCKETS);
  expect(cells.reduce((sum, c) => sum + c.kwh, 0)).toBeCloseTo(period.totalKwh, 6);
}

// ---------------------------------------------------------------------------
// entityWindowReads
// ---------------------------------------------------------------------------

function windowsOf(fx: EnergyViewReadFixture): { idx: number; start: Date; end: Date }[] {
  const empty = new Date(bucketStart(fx, 0).getTime() - 10 * DAY_MS);
  return [
    { idx: 0, ...wholeWindow(fx) },
    { idx: 1, start: bucketStart(fx, 12), end: bucketStart(fx, 20) },
    { idx: 2, start: empty, end: new Date(empty.getTime() + DAY_MS) },
  ];
}

/** 4 — every (asset, window) row carries its kWh and distinct bucket count. */
export async function assertAssetWindowRowsCarryKwhAndBuckets(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const rows = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: scopeA(fx) });
  const grid = rows.filter((r) => r.kind === "asset" && r.id === fx.gridAssetId).sort((a, b) => a.idx - b.idx);
  expect(grid.map((r) => [r.idx, r.bucketCount])).toEqual([
    [0, BUCKETS],
    [1, 9],
  ]);
  expect(grid[0]?.kwh).toBeCloseTo(sumOf(0, BUCKETS - 1, gridKw), 6);
  expect(grid[1]?.kwh).toBeCloseTo(sumOf(12, 20, gridKw), 6);
  expect(grid[0]?.locationId).toBe(fx.locationIds.a1);
  expect(grid[0]?.siteName).toBe(await locationName(fleet, fx.locationIds.a1));
  expect(grid[0]?.code).toMatch(/^EVR-.*-GRID$/);
}

/** 4 — a site's bucket count is its distinct buckets, not the sum over its two assets. */
export async function assertASiteCountsDistinctBuckets(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const rows = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: scopeA(fx) });
  const site = rows.find((r) => r.kind === "site" && r.id === fx.locationIds.a1 && r.idx === 0) ?? fail("site a1 row missing");
  expect(site.bucketCount).toBe(BUCKETS);
  expect(site.kwh).toBeCloseTo(sumOf(0, BUCKETS - 1, siteOneKw), 6);
  expect(site.locationId).toBe(fx.locationIds.a1);
  expect(site.code).toBeNull();
  expect(site.siteName).toBeNull();
  expect(site.name).toBe(await locationName(fleet, fx.locationIds.a1));
}

/** 4 — a window with no data has no row; the windows with data have theirs. */
export async function assertAnEmptyWindowIsAbsent(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const rows = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: scopeA(fx) });
  expect([...new Set(rows.map((r) => r.idx))].sort()).toEqual([0, 1]);
  // Two sites and three assets in each of the two windows with data.
  expect(rows).toHaveLength(10);
}

// ---------------------------------------------------------------------------
// Scope: the foreign asset changes nothing (one claim per read)
// ---------------------------------------------------------------------------

/** 5 — `siteEnergyRead`: no foreign site; the readable spike is present; the foreign id alone does read. */
export async function assertTheForeignAssetIsOutsideTheSiteRanking(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", ...wholeWindow(fx), limit: 50 } as const;
  const scoped = await siteEnergyRead(fleet, { ...window, assetIds: scopeA(fx) });
  expect(scoped.sites.map((s) => s.locationId)).not.toContain(fx.foreignLocationId);
  expect(Math.max(...scoped.sites.map((s) => s.peakKw))).toBeCloseTo(SPIKE_KW + PV_KW, 6);
  const foreign = await siteEnergyRead(fleet, { ...window, assetIds: [fx.foreignAssetId] });
  expect(foreign.sites.map((s) => s.locationId)).toEqual([fx.foreignLocationId]);
  // An unlisted asset in a listed site (the partial case): its kW stays out of the site's figures.
  const partial = await siteEnergyRead(fleet, { ...window, assetIds: withoutPv(fx) });
  const one = partial.sites.find((s) => s.locationId === fx.locationIds.a1) ?? fail("site a1 missing");
  expect(one.peakKw).toBeCloseTo(SPIKE_KW, 6);
  expect(one.kwh).toBeCloseTo(sumOf(0, BUCKETS - 1, gridKw), 6);
  expect(one.assetCount).toBe(1);
}

/** Organization A's assets without `PV`: an unlisted asset sharing a listed site. */
function withoutPv(fx: EnergyViewReadFixture): string[] {
  return [fx.gridAssetId, fx.siteTwoAssetId];
}

/** 5 — `siteSeriesRead`: no foreign column and no foreign kW; the spike is present. */
export async function assertTheForeignAssetIsOutsideTheSiteSeries(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", bucket: "1h", timeZone: "Etc/UTC", ...wholeWindow(fx), siteLimit: 8 } as const;
  const scoped = await siteSeriesRead(fleet, { ...window, assetIds: scopeA(fx) });
  expect(scoped.columns.map((c) => (c.kind === "site" ? c.locationId : "other"))).not.toContain(fx.foreignLocationId);
  const peak = Math.max(...scoped.points.map((p) => p.kw.reduce((s, v) => s + v, 0)));
  expect(peak).toBeCloseTo(SPIKE_KW + PV_KW + SITE_TWO_KW, 6);
  expect(peak).toBeLessThan(FOREIGN_KW);
  const foreign = await siteSeriesRead(fleet, { ...window, assetIds: [fx.foreignAssetId] });
  expect(foreign.columns).toEqual([{ kind: "site", locationId: fx.foreignLocationId, name: await locationName(fleet, fx.foreignLocationId) }]);
  const partial = await siteSeriesRead(fleet, { ...window, assetIds: withoutPv(fx) });
  expect(partial.points[SPIKE_BUCKET]?.kw[0]).toBeCloseTo(SPIKE_KW, 6);
}

/** 5 — `heatmapRead`: no cell holds the foreign kW; the spike's cell is present. */
export async function assertTheForeignAssetIsOutsideTheHeatmap(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const window = { level: "1h", timeZone: "Etc/UTC", ...wholeWindow(fx) } as const;
  const scoped = await heatmapRead(fleet, { ...window, assetIds: scopeA(fx) });
  expect(Math.max(...scoped.map((c) => c.kwh))).toBeCloseTo(SPIKE_KW + PV_KW + SITE_TWO_KW, 6);
  expect(scoped.every((c) => c.kwh < FOREIGN_KW)).toBe(true);
  const foreign = await heatmapRead(fleet, { ...window, assetIds: [fx.foreignAssetId] });
  expect(foreign.every((c) => Math.abs(c.kwh - FOREIGN_KW) < 1e-6)).toBe(true);
  expect(foreign).toHaveLength(BUCKETS);
  const partial = await heatmapRead(fleet, { ...window, assetIds: withoutPv(fx) });
  expect(Math.max(...partial.map((c) => c.kwh))).toBeCloseTo(SPIKE_KW + SITE_TWO_KW, 6);
}

/** 5 — `entityWindowReads`: no foreign asset or site row; the readable rows are present. */
export async function assertTheForeignAssetIsOutsideTheWindowReads(fleet: pg.Pool, fx: EnergyViewReadFixture): Promise<void> {
  const scoped = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: scopeA(fx) });
  const ids = scoped.map((r) => r.id);
  expect(ids).not.toContain(fx.foreignAssetId);
  expect(ids).not.toContain(fx.foreignLocationId);
  expect(ids).toContain(fx.gridAssetId);
  const foreign = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: [fx.foreignAssetId] });
  expect([...new Set(foreign.map((r) => r.id))].sort()).toEqual([fx.foreignAssetId, fx.foreignLocationId].sort());
  const partial = await entityWindowReads(fleet, { level: "1h", windows: windowsOf(fx), assetIds: withoutPv(fx) });
  expect(partial.map((r) => r.id)).not.toContain(fx.pvAssetId);
  const site = partial.find((r) => r.kind === "site" && r.id === fx.locationIds.a1 && r.idx === 0) ?? fail("site a1 row missing");
  expect(site.kwh).toBeCloseTo(sumOf(0, BUCKETS - 1, gridKw), 6);
}

// ---------------------------------------------------------------------------
// DST: a second fixture over the two most recent America/New_York transitions
// ---------------------------------------------------------------------------

const NEW_YORK = "America/New_York";

export interface DstFixture {
  readonly organizationId: string;
  readonly assetId: string;
  /** The fall-back instant (`06:00Z`, 02:00 EDT → 01:00 EST). */
  readonly fallBack: Date;
  /** The spring-forward instant (`07:00Z`, 02:00 EST → 03:00 EDT). */
  readonly springForward: Date;
}

/** The `n`th Sunday of `monthIndex` in `year`, at `hourUtc`. */
function nthSundayUtc(year: number, monthIndex: number, n: number, hourUtc: number): Date {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const firstSunday = 1 + ((7 - firstDay) % 7);
  return new Date(Date.UTC(year, monthIndex, firstSunday + (n - 1) * 7, hourUtc));
}

/** The most recent US transition at least two days before `now` (the 2007 rule). */
function latestTransition(now: Date, monthIndex: number, n: number, hourUtc: number): Date {
  for (let year = now.getUTCFullYear(); year > now.getUTCFullYear() - 3; year -= 1) {
    const t = nthSundayUtc(year, monthIndex, n, hourUtc);
    if (t.getTime() + 2 * HOUR_MS < now.getTime() - 2 * DAY_MS) return t;
  }
  return fail("no US DST transition found");
}

/** The fall-back buckets' kW: 00:00 EDT, 01:00 EDT, 01:00 EST, 02:00 EST. */
const FALL_KW = [11, 13, 17, 19] as const;
/** The spring-forward buckets' kW: 01:00 EST, 03:00 EDT, 04:00 EDT. */
const SPRING_KW = [23, 29, 31] as const;

function fallBuckets(fx: DstFixture): Date[] {
  return [-2, -1, 0, 1].map((h) => new Date(fx.fallBack.getTime() + h * HOUR_MS));
}

function springBuckets(fx: DstFixture): Date[] {
  return [-1, 0, 1].map((h) => new Date(fx.springForward.getTime() + h * HOUR_MS));
}

async function refreshAround(owner: pg.Pool, instants: readonly Date[]): Promise<void> {
  const times = instants.map((d) => d.getTime());
  const from = new Date(Math.min(...times) - 2 * HOUR_MS);
  const to = new Date(Math.max(...times) + 2 * HOUR_MS);
  await retryOnConcurrentRefresh(() => refreshAggregatesFrom(owner, from, to));
}

/** One organization, one location, one asset, `kw` samples in the two transitions' hours. */
export async function setUpDstFixture(superuser: pg.Pool, owner: pg.Pool): Promise<DstFixture> {
  const run = randomUUID().slice(0, 8).toUpperCase();
  const code = `EOR-${run}-DST`;
  const now = new Date();
  const { rows } = await superuser.query<{ id: string }>(
    `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id`,
    [code, `F4.299 organization reads ${code}`],
  );
  const organizationId = rows[0]?.id ?? fail(`organization ${code} was not inserted`);
  try {
    const { rows: loc } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, parent_id)
       VALUES ($1, $2, $3, $4, 'smoc_campus', 0, 0, NULL) RETURNING id`,
      [organizationId, `${code}-L`, `${code}-l`.toLowerCase(), `F4.299 ${code} site`],
    );
    const locationId = loc[0]?.id ?? fail("DST location was not inserted");
    const { rows: asset } = await superuser.query<{ id: string }>(
      `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
       VALUES ($1, $2, $3, $3, 'F4.299 organization reads', (SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1))
       RETURNING id`,
      [organizationId, locationId, `${code}-A`],
    );
    const fx: DstFixture = {
      organizationId,
      assetId: asset[0]?.id ?? fail("DST asset was not inserted"),
      fallBack: latestTransition(now, 10, 1, 6),
      springForward: latestTransition(now, 2, 2, 7),
    };
    const times: string[] = [];
    const values: number[] = [];
    fallBuckets(fx).forEach((t, i) => {
      times.push(new Date(t.getTime() + 10 * 60_000).toISOString());
      values.push(FALL_KW[i] as number);
    });
    springBuckets(fx).forEach((t, i) => {
      times.push(new Date(t.getTime() + 10 * 60_000).toISOString());
      values.push(SPRING_KW[i] as number);
    });
    try {
      await owner.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         SELECT t, $2::uuid, 'kw', v, 'kW' FROM unnest($1::timestamptz[], $3::float8[]) AS x(t, v)`,
        [times, fx.assetId, values],
      );
      await refreshAround(owner, fallBuckets(fx));
      await refreshAround(owner, springBuckets(fx));
    } catch (err) {
      await cleanupDstFixture(superuser, owner, fx);
      throw err;
    }
    return fx;
  } catch (err) {
    await dropOrganization(superuser, organizationId).catch(() => undefined);
    throw err;
  }
}

async function dropOrganization(superuser: pg.Pool, id: string): Promise<void> {
  await superuser.query(`DELETE FROM bms.assets WHERE organization_id = $1`, [id]);
  await superuser.query(`DELETE FROM bms.locations WHERE organization_id = $1`, [id]);
  await superuser.query(`DELETE FROM bms.organizations WHERE id = $1`, [id]);
}

/** Deletes the DST telemetry by asset id, re-refreshes both windows, drops the organization. Warns, never throws. */
export async function cleanupDstFixture(superuser: pg.Pool, owner: pg.Pool, fx: DstFixture): Promise<void> {
  try {
    await owner.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = 'kw'`, [fx.assetId]);
    await refreshAround(owner, fallBuckets(fx));
    await refreshAround(owner, springBuckets(fx));
    await dropOrganization(superuser, fx.organizationId);
  } catch (err: unknown) {
    process.stderr.write(
      `\n[F4.299] WARNING: DST fixture cleanup failed: ${err instanceof Error ? err.message : String(err)}\n` +
        "        Leftover rows may remain. Repair the aggregates with: pnpm db:refresh-aggregates\n\n",
    );
  }
}

function newYorkHour(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: NEW_YORK, hour: "2-digit", hourCycle: "h23" }).format(instant);
}

/** 3 — the fall-back day sums its two 01:00 buckets into one `hour 1` cell. */
export async function assertTheFallBackHourSumsTwoBuckets(fleet: pg.Pool, fx: DstFixture): Promise<void> {
  const buckets = fallBuckets(fx);
  // Fixture sanity: the two middle buckets are both 01:00 on the New York wall clock.
  expect(buckets.map(newYorkHour)).toEqual(["00", "01", "01", "02"]);
  const cells = await heatmapRead(fleet, {
    level: "1h",
    timeZone: NEW_YORK,
    start: buckets[0] as Date,
    end: buckets[3] as Date,
    assetIds: [fx.assetId],
  });
  const day = utcDateOf(fx.fallBack);
  expect(cells.map((c) => [c.day, c.hour, c.kwh])).toEqual([
    [day, 0, FALL_KW[0]],
    [day, 1, FALL_KW[1] + FALL_KW[2]],
    [day, 2, FALL_KW[3]],
  ]);
}

/** 3 — the spring-forward day has no `hour 2` cell. */
export async function assertTheSpringForwardDayHasNoHourTwo(fleet: pg.Pool, fx: DstFixture): Promise<void> {
  const buckets = springBuckets(fx);
  expect(buckets.map(newYorkHour)).toEqual(["01", "03", "04"]);
  const cells = await heatmapRead(fleet, {
    level: "1h",
    timeZone: NEW_YORK,
    start: buckets[0] as Date,
    end: buckets[2] as Date,
    assetIds: [fx.assetId],
  });
  const day = utcDateOf(fx.springForward);
  expect(cells.map((c) => [c.day, c.hour, c.kwh])).toEqual([
    [day, 1, SPRING_KW[0]],
    [day, 3, SPRING_KW[1]],
    [day, 4, SPRING_KW[2]],
  ]);
}

// ---------------------------------------------------------------------------
// Statement shape, through a local recording pool (no database)
// ---------------------------------------------------------------------------

type Recorded = { readonly text: string; readonly params: readonly unknown[] };

/** A `pg.Pool` stand-in that records `{ text, params }` and answers no rows. */
function recordingQueryable(): { pool: pg.Pool; statements: Recorded[] } {
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
const WINDOWS = [
  { idx: 0, start: START, end: END },
  { idx: 1, start: new Date("2026-09-30T00:00:00.000Z"), end: new Date("2026-09-30T23:59:59.999Z") },
];

function only(statements: readonly Recorded[]): Recorded {
  expect(statements).toHaveLength(1);
  return statements[0] ?? fail("no statement recorded");
}

/** The statement binds the scope's list at an `= ANY($n::uuid[])` and has no nullable leg or `LIKE`. */
function expectTheScopeIsBound({ text, params }: Recorded): void {
  const positions = [...text.matchAll(/= ANY\(\$(\d+)::uuid\[\]\)/g)].map((m) => Number(m[1]));
  expect(positions.length).toBeGreaterThan(0);
  expect(positions.some((n) => JSON.stringify(params[n - 1]) === JSON.stringify(SCOPE))).toBe(true);
  expect(text).not.toMatch(/IS NULL OR/i);
  expect(text).not.toMatch(/LIKE/i);
}

/** 6 — `siteEnergyRead` binds the list; the `locationIds` leg binds its own list. */
export async function assertSiteEnergyReadBindsTheList(): Promise<void> {
  const { pool, statements } = recordingQueryable();
  await siteEnergyRead(pool, { level: "1h", start: START, end: END, assetIds: SCOPE, limit: 50 });
  expectTheScopeIsBound(only(statements));
  const narrowed = recordingQueryable();
  const location = "00000000-0000-4000-8000-0000000000aa";
  await siteEnergyRead(narrowed.pool, { level: "1h", start: START, end: END, assetIds: SCOPE, limit: 50, locationIds: [location] });
  const sent = only(narrowed.statements);
  expectTheScopeIsBound(sent);
  expect(sent.text).toMatch(/l\.id = ANY\(\$6::uuid\[\]\)/);
  expect(sent.params[5]).toEqual([location]);
}

/** 6 — `siteSeriesRead` binds the list; a `1d` bucket binds the zone at the index `displayGroupExpr` was given. */
export async function assertSiteSeriesReadBindsTheListAndTheZone(): Promise<void> {
  const { pool, statements } = recordingQueryable();
  await siteSeriesRead(pool, {
    level: "1h",
    bucket: "1d",
    timeZone: "Asia/Kolkata",
    start: START,
    end: END,
    assetIds: SCOPE,
    siteLimit: 8,
  });
  const sent = only(statements);
  expectTheScopeIsBound(sent);
  const index = Number(/time_bucket\(INTERVAL '1 day', agg\.bucket, \$(\d+)::text\)/.exec(sent.text)?.[1]);
  expect(sent.params[index - 1]).toBe("Asia/Kolkata");
  expect(sent.text).not.toContain("Asia/Kolkata");
  expect(sent.text).not.toContain("point_values_1d");
}

/** 6 — `heatmapRead` binds the list and the zone as a parameter, never interpolated. */
export async function assertHeatmapReadBindsTheListAndTheZone(): Promise<void> {
  const { pool, statements } = recordingQueryable();
  await heatmapRead(pool, { level: "1h", timeZone: "Asia/Kolkata", start: START, end: END, assetIds: SCOPE });
  const sent = only(statements);
  expectTheScopeIsBound(sent);
  const zone = [...sent.text.matchAll(/AT TIME ZONE \$(\d+)::text/g)].map((m) => Number(m[1]));
  expect(zone.length).toBeGreaterThan(0);
  for (const n of zone) expect(sent.params[n - 1]).toBe("Asia/Kolkata");
  expect(sent.text).not.toContain("Asia/Kolkata");
}

/** 6 — `entityWindowReads` binds the list and groups by both grouping sets. */
export async function assertEntityWindowReadsBindsTheList(): Promise<void> {
  const { pool, statements } = recordingQueryable();
  await entityWindowReads(pool, { level: "1h", windows: WINDOWS, assetIds: SCOPE });
  const sent = only(statements);
  expectTheScopeIsBound(sent);
  expect(sent.text).toMatch(/GROUPING SETS/);
  expect(sent.text).toMatch(/count\(DISTINCT per\.bucket\)/);
}

/** 7 — an empty scope returns the empty result for each read and sends no statement. */
export async function assertAnEmptyScopeSendsNoOrganizationStatement(): Promise<void> {
  const { pool, statements } = recordingQueryable();
  expect(await siteEnergyRead(pool, { level: "1h", start: START, end: END, assetIds: [], limit: 50 })).toEqual({
    sites: [],
    totalSites: 0,
  });
  expect(
    await siteSeriesRead(pool, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: [], siteLimit: 8 }),
  ).toEqual({ columns: [], points: [] });
  expect(await heatmapRead(pool, { level: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: [] })).toEqual([]);
  expect(await entityWindowReads(pool, { level: "1h", windows: WINDOWS, assetIds: [] })).toEqual([]);
  expect(statements).toHaveLength(0);
}

/** 7, paired — one id sends exactly one statement per read, so the absence above is not vacuous. */
export async function assertOneIdSendsOneOrganizationStatementPerRead(): Promise<void> {
  const one = [SCOPE[0] ?? fail("no id")];
  const { pool, statements } = recordingQueryable();
  await siteEnergyRead(pool, { level: "1h", start: START, end: END, assetIds: one, limit: 50 });
  expect(statements).toHaveLength(1);
  await siteSeriesRead(pool, { level: "1h", bucket: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: one, siteLimit: 8 });
  expect(statements).toHaveLength(2);
  await heatmapRead(pool, { level: "1h", timeZone: "Etc/UTC", start: START, end: END, assetIds: one });
  expect(statements).toHaveLength(3);
  await entityWindowReads(pool, { level: "1h", windows: WINDOWS, assetIds: one });
  expect(statements).toHaveLength(4);
}
