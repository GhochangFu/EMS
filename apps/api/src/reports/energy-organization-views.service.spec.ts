import { ForbiddenException } from "@nestjs/common";
import { expect } from "vitest";

import {
  ABNORMAL_LIST_MAX,
  ABNORMAL_RATIO,
  BASELINE_WINDOWS,
  SITE_RANKING_MAX,
  TREND_SITE_SERIES_MAX,
  type EnergySiteEnergy,
  type EnergyViewQuery,
  type JwtPayload,
} from "@bms/shared";

import type { EntityWindowRow } from "./energy-abnormal";
import type { EnergyViewFrame } from "./energy-view.service";
import {
  EnergyOrganizationViewsService,
  type EnergyOrganizationReads,
} from "./energy-organization-views.service";

/**
 * `F4.299` U4 (ADR 0108 Amendment 1, 7.2–7.8) — `EnergyOrganizationViewsService`
 * over fakes: a `frame` fake and recording read fakes. The scope lives in SQL
 * (the integration suite proves it); here every read must receive the
 * frame's list and bounds, the compare read the current sites, the abnormal
 * read the windows inside the retention horizon only. Vitest entry point: the
 * sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const ASSET_1 = "a0000000-0000-4000-8000-000000000001";
const ASSET_2 = "a0000000-0000-4000-8000-000000000002";
const SITE_1 = "50000000-0000-4000-8000-000000000001";
const SITE_2 = "50000000-0000-4000-8000-000000000002";
const REQUEST_SITE = "40000000-0000-4000-8000-0000000000ff";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function frameOf(overrides: Partial<EnergyViewFrame> = {}): EnergyViewFrame {
  const end = NOW;
  const start = new Date(NOW.getTime() - 24 * HOUR_MS);
  return {
    organizationId: ORG,
    assetIds: [ASSET_1, ASSET_2],
    zone: { timeZone: "UTC", arithmeticZone: "Etc/UTC" },
    current: { start, end, durationHours: 24 },
    previous: null,
    level: "5m",
    bucket: "1h",
    partial: { readableSites: 1, selectedSites: 2 },
    now: NOW,
    ...overrides,
  };
}

function site(locationId: string, kwh: number): EnergySiteEnergy {
  return { locationId, name: `Site ${locationId.slice(-1)}`, assetCount: 1, kwh, peakKw: kwh / 10, peakAt: NOW.toISOString() };
}

type Calls = {
  frame: unknown[][];
  siteEnergy: Parameters<EnergyOrganizationReads["siteEnergyRead"]>[1][];
  siteSeries: Parameters<EnergyOrganizationReads["siteSeriesRead"]>[1][];
  heatmap: Parameters<EnergyOrganizationReads["heatmapRead"]>[1][];
  windows: Parameters<EnergyOrganizationReads["entityWindowReads"]>[1][];
};

function harness(
  options: {
    frame?: EnergyViewFrame | Error;
    sites?: EnergySiteEnergy[];
    rows?: EntityWindowRow[];
  } = {},
) {
  const calls: Calls = { frame: [], siteEnergy: [], siteSeries: [], heatmap: [], windows: [] };
  const sites = options.sites ?? [site(SITE_1, 120), site(SITE_2, 80)];
  const reads: EnergyOrganizationReads = {
    siteEnergyRead: async (_pool, input) => {
      calls.siteEnergy.push(input);
      return { sites, totalSites: sites.length };
    },
    siteSeriesRead: async (_pool, input) => {
      calls.siteSeries.push(input);
      return {
        columns: [{ kind: "site", locationId: SITE_1, name: "Site 1" }],
        points: [{ t: NOW.toISOString(), kw: [12.345] }],
      };
    },
    heatmapRead: async (_pool, input) => {
      calls.heatmap.push(input);
      return [{ day: "2026-11-01", hour: 11, kwh: 5.678 }];
    },
    entityWindowReads: async (_pool, input) => {
      calls.windows.push(input);
      return options.rows ?? [];
    },
  };
  const frame = options.frame ?? frameOf();
  const views = {
    frame: async (user: JwtPayload, query: EnergyViewQuery) => {
      calls.frame.push([user, query]);
      if (frame instanceof Error) throw frame;
      return frame;
    },
  };
  const service = new EnergyOrganizationViewsService({} as never, views, reads);
  return { service, calls };
}

function totalReads(calls: Calls): number {
  return calls.siteEnergy.length + calls.siteSeries.length + calls.heatmap.length + calls.windows.length;
}

/** One entity's rows: the current period at `currentKwh` and four full windows at `baselineKwh`. */
function entityRows(kind: "site" | "asset", id: string, name: string, currentKwh: number, baselineKwh: number): EntityWindowRow[] {
  return [0, 1, 2, 3, 4].map((idx) => ({
    kind,
    id,
    locationId: kind === "site" ? id : SITE_1,
    code: kind === "site" ? null : `C-${name}`,
    name,
    siteName: kind === "site" ? null : "Site 1",
    idx,
    kwh: idx === 0 ? currentKwh : baselineKwh,
    bucketCount: 288,
  }));
}

function assetId(n: number): string {
  return `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Every read receives exactly the frame's asset list — never an id from the request. */
export async function everyReadReceivesTheFrameAssetIds(): Promise<void> {
  const h = harness({ frame: frameOf({ previous: { start: new Date(NOW.getTime() - 48 * HOUR_MS), end: new Date(NOW.getTime() - 24 * HOUR_MS), durationHours: 24 } }) });
  await h.service.organizationViews(USER, { range: "24h", organizationId: ORG, locationIds: [REQUEST_SITE], compare: "previous" });
  const lists = [...h.calls.siteEnergy, ...h.calls.siteSeries, ...h.calls.heatmap, ...h.calls.windows].map((input) => input.assetIds);
  expect(lists).toHaveLength(5);
  for (const list of lists) expect(list).toEqual([ASSET_1, ASSET_2]);
  expect(JSON.stringify(lists)).not.toContain(REQUEST_SITE);
}

/** The frame is asked once, with the user and the query as given. */
export async function theFrameIsAskedOnceWithTheUserAndQuery(): Promise<void> {
  const h = harness();
  const query: EnergyViewQuery = { range: "24h", organizationId: ORG };
  await h.service.organizationViews(USER, query);
  expect(h.calls.frame).toEqual([[USER, query]]);
}

/** Without compare: `sites.compare` is null, `compare` bounds are null, and the ranking is read once. */
export async function withoutCompareTheRankingIsReadOnce(): Promise<void> {
  const h = harness();
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(h.calls.siteEnergy).toHaveLength(1);
  expect(h.calls.siteEnergy[0]).toMatchObject({ level: "5m", limit: SITE_RANKING_MAX, start: frameOf().current.start, end: NOW });
  expect(h.calls.siteEnergy[0]?.locationIds).toBeUndefined();
  expect(out.sites.compare).toBeNull();
  expect(out.compare).toBeNull();
}

/** With compare: a second ranking read over the previous bounds, bounded to the current rows' locations. */
export async function withCompareThePreviousPeriodIsReadForTheCurrentSites(): Promise<void> {
  const previous = { start: new Date(NOW.getTime() - 48 * HOUR_MS), end: new Date(NOW.getTime() - 24 * HOUR_MS), durationHours: 24 };
  const h = harness({ frame: frameOf({ previous }) });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG, compare: "previous" });
  expect(h.calls.siteEnergy).toHaveLength(2);
  expect(h.calls.siteEnergy[1]).toMatchObject({ start: previous.start, end: previous.end, locationIds: [SITE_1, SITE_2] });
  expect(out.sites.compare).not.toBeNull();
  expect(out.compare).toEqual({ from: previous.start.toISOString(), to: previous.end.toISOString(), durationHours: 24 });
}

/** An empty scope: every section empty, zero counts, and no read touched. */
export async function anEmptyScopeTouchesNoRead(): Promise<void> {
  const h = harness({ frame: frameOf({ assetIds: [] }) });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG, compare: "previous" });
  expect(totalReads(h.calls)).toBe(0);
  expect(out.sites).toEqual({ current: [], compare: null, totalSites: 0 });
  expect(out.trend).toEqual({ columns: [], points: [] });
  expect(out.heatmap).toEqual({ cells: [] });
  expect(out.abnormal.entries).toEqual([]);
  expect(out.abnormal.normalCount).toEqual({ sites: 0, assets: 0 });
  expect(out.abnormal.truncated).toBe(false);
}

/** The paired positive: a non-empty scope reads every section (four reads, no compare). */
export async function aNonEmptyScopeReadsEverySection(): Promise<void> {
  const h = harness();
  await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect([h.calls.siteEnergy.length, h.calls.siteSeries.length, h.calls.heatmap.length, h.calls.windows.length]).toEqual([1, 1, 1, 1]);
}

/** A refusal from the frame propagates, and no read runs. */
export async function aFrameRefusalPropagatesBeforeAnyRead(): Promise<void> {
  const h = harness({ frame: new ForbiddenException("organizationId is outside your access scope") });
  await expect(h.service.organizationViews(USER, { range: "24h", organizationId: ORG })).rejects.toBeInstanceOf(ForbiddenException);
  expect(totalReads(h.calls)).toBe(0);
}

/** The response echoes the frame: zone, level, bucket, partial, organization and bounds. */
export async function theResponseEchoesTheFrame(): Promise<void> {
  const h = harness({ frame: frameOf({ zone: { timeZone: "UTC", arithmeticZone: "Etc/UTC" }, level: "1h", bucket: "1d" }) });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(out.organizationId).toBe(ORG);
  expect(out.timeZone).toBe("UTC");
  expect(out.level).toBe("1h");
  expect(out.bucket).toBe("1d");
  expect(out.partial).toEqual({ readableSites: 1, selectedSites: 2 });
  expect(out.current).toEqual({ from: frameOf().current.start.toISOString(), to: NOW.toISOString(), durationHours: 24 });
}

/** The trend and the heatmap read in the arithmetic zone (a stored `UTC` computes as `Etc/UTC`), with the series cap. */
export async function theZonedReadsUseTheArithmeticZone(): Promise<void> {
  const h = harness();
  await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(h.calls.siteSeries[0]).toMatchObject({ timeZone: "Etc/UTC", bucket: "1h", level: "5m", siteLimit: TREND_SITE_SERIES_MAX });
  expect(h.calls.heatmap[0]).toMatchObject({ timeZone: "Etc/UTC", level: "5m" });
}

/**
 * Retention: at `5m` (735 d), a 24 h period starting 733 d back has windows
 * starting 734, 735, 736 and 737 d back; the last two are not read, and
 * `windowsConsulted` is 2. Mutation: drop the horizon filter → the fake sees
 * five windows → red.
 */
export async function windowsPastTheHorizonAreNotRead(): Promise<void> {
  const start = new Date(NOW.getTime() - 733 * DAY_MS);
  const current = { start, end: new Date(start.getTime() + 24 * HOUR_MS), durationHours: 24 };
  const h = harness({ frame: frameOf({ current, level: "5m" }) });
  const out = await h.service.organizationViews(USER, { range: "custom", organizationId: ORG });
  const windows = h.calls.windows[0]?.windows ?? [];
  expect(windows.map((w) => w.idx)).toEqual([0, 1, 2]);
  expect(windows[0]).toEqual({ idx: 0, start: current.start, end: current.end });
  expect(out.abnormal.baseline).toEqual({ windows: BASELINE_WINDOWS, windowsConsulted: 2, stepDays: 1, ratio: ABNORMAL_RATIO });
}

/** The paired positive: a recent period reads all four windows. */
export async function aRecentPeriodReadsAllFourWindows(): Promise<void> {
  const h = harness();
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(h.calls.windows[0]?.windows.map((w) => w.idx)).toEqual([0, 1, 2, 3, 4]);
  expect(out.abnormal.baseline.windowsConsulted).toBe(BASELINE_WINDOWS);
}

/** `normal` entities are counted, never sent; `above` is sent with its ratio. */
export async function normalEntitiesAreCountedNotSent(): Promise<void> {
  const rows = [
    ...entityRows("site", SITE_1, "Site 1", 200, 100),
    ...entityRows("asset", ASSET_1, "Pump", 110, 100),
    ...entityRows("asset", ASSET_2, "Chiller", 100, 100),
  ];
  const h = harness({ rows });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(out.abnormal.entries.map((e) => [e.kind, e.id, e.verdict, e.ratio])).toEqual([["site", SITE_1, "above", 2]]);
  expect(out.abnormal.normalCount).toEqual({ sites: 0, assets: 2 });
  expect(JSON.stringify(out.abnormal.entries)).not.toContain(ASSET_1);
}

/** 101 `above` entities: 100 sent, `truncated`. */
export async function theAbnormalListIsCutAtTheMaxWithTruncated(): Promise<void> {
  const rows = Array.from({ length: ABNORMAL_LIST_MAX + 1 }, (_, n) =>
    entityRows("asset", assetId(n), `Asset ${String(n).padStart(3, "0")}`, 200, 100),
  ).flat();
  const h = harness({ rows });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(out.abnormal.entries).toHaveLength(ABNORMAL_LIST_MAX);
  expect(out.abnormal.truncated).toBe(true);
}

/** Figures are rounded on the way out: kWh and kW to 2 places. */
export async function figuresAreRoundedOnTheWayOut(): Promise<void> {
  const h = harness({ sites: [site(SITE_1, 120.12345)] });
  const out = await h.service.organizationViews(USER, { range: "24h", organizationId: ORG });
  expect(out.sites.current[0]?.kwh).toBe(120.12);
  expect(out.trend.points[0]?.kw).toEqual([12.35]);
  expect(out.heatmap.cells[0]?.kwh).toBe(5.68);
}
