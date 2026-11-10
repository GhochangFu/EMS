import { expect } from "vitest";

import { encodePointRef } from "@bms/shared";
import type { DashboardWidgetDto, DashboardWidgetPointDto, GeneratedSiteAssetDto } from "@bms/shared";

import { isScalarData } from "../components/widgets/dashboard-widget";
import { chunkIds } from "../hooks/use-asset-windows";
import { widgetDataFor } from "./dashboard-widget-data";
import { assetStatus } from "./generated-site-view";
import { mimicNodeFlows, mimicNodeStatus } from "./mimic";
import { FRESH_MS, freshWindowMs, isStale } from "./schematic-telemetry";
import { wallBar } from "./wall-mode";

/**
 * `F4.350` (ADR 0075 Amendment 3) — the web judges each asset on the window the API gave it
 * (`freshnessWindowSeconds`), with the 25 s `FRESH_MS` as the floor. A 60 s device has a 150 s
 * window: live at 55 s, stale at 160 s; the old fixed 25 s read both stale. Assertions live here;
 * `fresh-window.test.ts` is the Vitest entry point (ADR 0014).
 */

const NOW = Date.parse("2026-11-10T10:00:00.000Z");
const ago = (seconds: number): number => NOW - seconds * 1000;
const agoIso = (seconds: number): string => new Date(ago(seconds)).toISOString();

/** W1 — the API's seconds become ms, never below the floor, and a missing or malformed value is the floor. */
export function freshWindowMsIsTheWindowOrTheFloor(): void {
  expect(freshWindowMs(150)).toBe(150_000);
  expect(freshWindowMs(900)).toBe(900_000);
  for (const bad of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(freshWindowMs(bad), String(bad)).toBe(FRESH_MS);
  }
  expect(freshWindowMs(10), "below the floor is the floor").toBe(FRESH_MS);
  expect(freshWindowMs(0)).toBe(FRESH_MS);
}

/** W2 — `isStale` defaults to the floor and takes the asset's window; the boundary is exclusive, as before. */
export function isStaleTakesTheAssetsWindow(): void {
  expect(isStale(ago(30), NOW), "30 s old on the default floor").toBe(true);
  expect(isStale(ago(25), NOW), "exactly 25 s is still live").toBe(false);
  expect(isStale(ago(55), NOW, 150_000), "55 s old, a 60 s device").toBe(false);
  expect(isStale(ago(150), NOW, 150_000), "exactly the window is still live").toBe(false);
  expect(isStale(ago(160), NOW, 150_000), "160 s old, a 60 s device").toBe(true);
  expect(isStale(null, NOW, 150_000), "never contacted").toBe(true);
  expect(isStale(NOW + 1000, NOW, 150_000), "a future sample is never trusted").toBe(true);
}

/** W3 — `assetStatus` follows the same window. */
export function assetStatusFollowsTheWindow(): void {
  expect(assetStatus(ago(55), NOW)).toBe("stale");
  expect(assetStatus(ago(55), NOW, 150_000)).toBe("live");
  expect(assetStatus(ago(160), NOW, 150_000)).toBe("stale");
  expect(assetStatus(null, NOW, 150_000)).toBe("none");
}

/** W4 — the wall bar judges the newest read on the canvas's widest window. */
export function wallBarUsesTheWindow(): void {
  expect(wallBar(ago(55), NOW)).toEqual({ kind: "paused", since: ago(55) });
  expect(wallBar(ago(55), NOW, 150_000)).toEqual({ kind: "live", updatedAt: ago(55) });
  expect(wallBar(ago(160), NOW, 150_000).kind).toBe("paused");
  expect(wallBar(null, NOW, 150_000)).toEqual({ kind: "paused", since: null });
}

const POINT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POINT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function point(assetId: string): DashboardWidgetPointDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    pointId: "55555555-5555-4555-8555-555555555555",
    role: "primary",
    sortOrder: 0,
    assetId,
    assetCode: "X",
    assetRtuName: null,
    assetLocationName: null,
    pointKey: "temp_c",
    unit: "C",
  };
}

function tile(assetId: string): DashboardWidgetDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    sources: [],
    tabId: null,
    widgetType: "value_tile",
    config: { unit: "C", decimals: 1 },
    points: [point(assetId)],
  };
}

/** W5 — a value tile over a 60 s device is live at 55 s with its window, stale without one, stale at 160 s. */
export function widgetTileAgesOnTheAssetsWindow(): void {
  const ref = encodePointRef(POINT_A, "temp_c");
  const latest = (seconds: number) => new Map([[ref, { value: 21, time: agoIso(seconds) }]]);
  const windowOf = (assetId: string): number => (assetId === POINT_A ? 150_000 : FRESH_MS);

  const live = widgetDataFor(tile(POINT_A), latest(55), new Map(), NOW, undefined, undefined, windowOf);
  expect(isScalarData(live) && live.stale).toBe(false);
  const floorOnly = widgetDataFor(tile(POINT_A), latest(55), new Map(), NOW);
  expect(isScalarData(floorOnly) && floorOnly.stale, "no window given = the floor").toBe(true);
  const stale = widgetDataFor(tile(POINT_A), latest(160), new Map(), NOW, undefined, undefined, windowOf);
  expect(isScalarData(stale) && stale.stale).toBe(true);
  // A window belongs to its own asset: another asset keeps the floor.
  const other = widgetDataFor(tile(POINT_B), new Map([[encodePointRef(POINT_B, "temp_c"), { value: 1, time: agoIso(55) }]]), new Map(), NOW, undefined, undefined, windowOf);
  expect(isScalarData(other) && other.stale).toBe(true);
}

function siteAsset(freshnessWindowSeconds: number | undefined): GeneratedSiteAssetDto {
  return {
    id: POINT_A,
    code: "WBL-1",
    name: "Room 1",
    assetRtuName: null,
    assetLocationName: null,
    domain: "hvac",
    latestTelemetryAt: agoIso(55),
    freshness: "live",
    ...(freshnessWindowSeconds === undefined ? {} : { freshnessWindowSeconds }),
    points: [],
  };
}

/** W6 — a mimic node reads live on its asset's window, and its pipe flows on the same window. */
export function mimicNodeUsesTheAssetsWindow(): void {
  const node = (asset: GeneratedSiteAssetDto) => ({ asset, activeAlarms: 0 });
  expect(mimicNodeStatus(node(siteAsset(150)), ago(55), NOW)).toBe("live");
  expect(mimicNodeStatus(node(siteAsset(undefined)), ago(55), NOW)).toBe("stale");
  expect(mimicNodeStatus(node(siteAsset(150)), ago(160), NOW)).toBe("stale");
  expect(mimicNodeFlows("alarm", ago(55), NOW, 150_000)).toBe(true);
  expect(mimicNodeFlows("alarm", ago(55), NOW)).toBe(false);
}

/** W7 — the windows read goes out in calls of at most the API's 50 ids. */
export function windowsAreRequestedFiftyAtATime(): void {
  const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
  const chunks = chunkIds(ids);
  expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
  expect(chunks.flat()).toEqual(ids);
  expect(chunkIds([])).toEqual([]);
}
