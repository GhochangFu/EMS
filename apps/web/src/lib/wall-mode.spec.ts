import { expect } from "vitest";

import { FRESH_MS } from "./schematic-telemetry";
import {
  formatWallTime,
  newestReadMs,
  nextTabKey,
  parseWallParams,
  settleWallZoom,
  WALL_DEFAULT_S,
  WALL_ZOOM_FLOOR,
  WALL_ASPECT_CAP_FRACTION,
  wallAspectCapPx,
  wallBar,
  wallBaseZoom,
  wallFitZoom,
  wallHref,
} from "./wall-mode";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D7) — the pure half of wall mode: the URL
 * parameters, the next tab of a rotation, the newest read and the bar's live/paused rule.
 * Assertions live here; `wall-mode.test.ts` is the Vitest entry point (ADR 0014).
 */

/** W1 — `wall` is on only for exactly `"1"`. */
export function wallIsOnOnlyForOne(): void {
  expect(parseWallParams("?wall=1").on).toBe(true);
  expect(parseWallParams("?wall=yes").on).toBe(false);
  expect(parseWallParams("?wall=true").on).toBe(false);
  expect(parseWallParams("").on).toBe(false);
}

/** W2 — `every` is one of the four intervals, else the default (30 s). */
export function everyFallsBackToTheDefault(): void {
  expect(WALL_DEFAULT_S).toBe(30);
  expect(parseWallParams("?wall=1&every=45").everyS).toBe(30);
  expect(parseWallParams("?wall=1&every=abc").everyS).toBe(30);
  expect(parseWallParams("?wall=1").everyS).toBe(30);
  expect(parseWallParams("?wall=1&every=120").everyS).toBe(120);
  expect(parseWallParams("?wall=1&every=15").everyS).toBe(15);
  expect(parseWallParams("?wall=1&every=60").everyS).toBe(60);
}

/** W3 — the wall URL keeps the tab in the path segment (OQ2); no tab is the bare site path. */
export function wallHrefKeepsTheTabInThePath(): void {
  expect(wallHref("/control-room/site/p1", "sld", 15)).toBe("/control-room/site/p1/sld?wall=1&every=15");
  expect(wallHref("/control-room/site/p1", undefined, 30)).toBe("/control-room/site/p1?wall=1&every=30");
  expect(wallHref("/control-room/site/p1", "a b", 30)).toBe("/control-room/site/p1/a%20b?wall=1&every=30");
}

/** W4 — the next tab wraps and skips nothing; the bare path (no key) is the first tab. */
export function nextTabKeyWrapsAndSkipsNothing(): void {
  const keys = ["overview", "sld", "hvac"];
  expect(nextTabKey(keys, "overview")).toBe("sld");
  expect(nextTabKey(keys, "sld")).toBe("hvac");
  expect(nextTabKey(keys, "hvac")).toBe("overview");
  expect(nextTabKey(keys, undefined)).toBe("sld");
  // A full round visits every key once and comes back: equal turns.
  const seen: string[] = [];
  let current: string | undefined = "overview";
  for (let turn = 0; turn < keys.length; turn += 1) {
    current = nextTabKey(keys, current) ?? undefined;
    seen.push(current as string);
  }
  expect(seen).toEqual(["sld", "hvac", "overview"]);
  expect(nextTabKey([], undefined)).toBeNull();
}

/** W5 — the newest read is the latest of the samples, the catalog read and the site-widgets read. */
export function newestReadIsTheMaximum(): void {
  const t1 = Date.UTC(2026, 9, 2, 4, 0, 0);
  const t2 = t1 + 7_000;
  const t3 = t1 + 3_000;
  expect(
    newestReadMs({
      latestByRef: new Map([
        ["a", { value: 1, time: new Date(t1).toISOString() }],
        ["b", null],
      ]),
      catalogResolvedAt: new Date(t2).toISOString(),
      siteWidgetsUpdatedAt: t3,
    }, t1 + 60_000),
  ).toBe(t2);
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: new Date(t2).toISOString() }]]),
      catalogResolvedAt: null,
      siteWidgetsUpdatedAt: undefined,
    }, t1 + 60_000),
  ).toBe(t2);
}

/** W6 — no read at all, a never-updated query (`0`) and an unparsable time are no evidence. */
export function newestReadIgnoresWhatIsNoEvidence(): void {
  const t1 = Date.UTC(2026, 9, 2, 4, 0, 0);
  const now = t1 + 60_000;
  expect(newestReadMs({ latestByRef: new Map(), catalogResolvedAt: null, siteWidgetsUpdatedAt: undefined }, now)).toBeNull();
  expect(newestReadMs({ latestByRef: new Map(), catalogResolvedAt: null, siteWidgetsUpdatedAt: 0 }, now)).toBeNull();
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: "not a time" }]]),
      catalogResolvedAt: "garbage",
      siteWidgetsUpdatedAt: t1,
    }, now),
  ).toBe(t1);
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: "not a time" }]]),
      catalogResolvedAt: "garbage",
      siteWidgetsUpdatedAt: Number.NaN,
    }, now),
  ).toBeNull();
}

/**
 * W10 — `F4.37`'s clamp: a sample or a catalog read ahead of the wall PC's clock reads as `now`,
 * so the bar is live (as the tiles are), never "paused since <a future time>". Each source on its
 * own case, so dropping the clamp on either one reddens its own claim.
 */
export function newestReadClampsAFutureTime(): void {
  const now = Date.UTC(2026, 9, 2, 4, 0, 0);
  const ahead = new Date(now + 60_000).toISOString();
  const fromSample = newestReadMs(
    { latestByRef: new Map([["a", { value: 1, time: ahead }]]), catalogResolvedAt: null, siteWidgetsUpdatedAt: undefined },
    now,
  );
  expect(fromSample).toBe(now);
  expect(wallBar(fromSample, now)).toEqual({ kind: "live", updatedAt: now });
  const fromCatalog = newestReadMs(
    { latestByRef: new Map(), catalogResolvedAt: ahead, siteWidgetsUpdatedAt: undefined },
    now,
  );
  expect(fromCatalog).toBe(now);
}

/**
 * W11 — the frame judges on a one-second tick, so a read reported a moment after that tick is
 * ahead of the frame's `now`. The bar clamps it and stays live; it is not "paused" until the tick.
 */
export function wallBarClampsAReadAheadOfTheClock(): void {
  const now = Date.UTC(2026, 9, 2, 4, 0, 0);
  expect(wallBar(now + 500, now)).toEqual({ kind: "live", updatedAt: now });
}

/** W7 — the bar is live at exactly `FRESH_MS` old and paused one ms later (OQ5: `isStale`). */
export function wallBarFollowsIsStale(): void {
  const read = Date.UTC(2026, 9, 2, 4, 0, 0);
  expect(wallBar(read, read + FRESH_MS)).toEqual({ kind: "live", updatedAt: read });
  expect(wallBar(read, read + FRESH_MS + 1)).toEqual({ kind: "paused", since: read });
}

/** W8 — no read yet is paused with no time: nothing proves the data is live. */
export function noReadIsPausedWithNoTime(): void {
  expect(wallBar(null, Date.UTC(2026, 9, 2, 4, 0, 0))).toEqual({ kind: "paused", since: null });
}

/** W9 — the bar's times are 24-hour `hh:mm:ss` in local time, zero padded. */
export function wallTimeIsPaddedLocalTime(): void {
  expect(formatWallTime(new Date(2026, 9, 2, 10, 15, 30).getTime())).toBe("10:15:30");
  expect(formatWallTime(new Date(2026, 9, 2, 7, 5, 3).getTime())).toBe("07:05:03");
  expect(formatWallTime(new Date(2026, 9, 2, 23, 0, 9).getTime())).toBe("23:00:09");
}

/**
 * Z1 (`F3.77` follow-up, plan D5) — the base zoom is 1.25, and 2.5 from 3000 px wide (a 4K wall).
 * The edge pair (2999 / 3000) is what a `>` for `>=` would turn red.
 */
export function baseZoomFollowsTheWidth(): void {
  expect([wallBaseZoom(1920), wallBaseZoom(2999), wallBaseZoom(3000)]).toEqual([1.25, 1.25, 2.5]);
}

/** Z2 — content taller than the screen at the base zooms to fit, floored to 2 decimals (1.0305 → 1.03). */
export function fitZoomFloorsToTwoDecimals(): void {
  expect(wallFitZoom({ base: 1.25, viewportHeight: 1080, naturalPx: 1048, floor: WALL_ZOOM_FLOOR })).toBe(1.03);
}

/** Z3 — content that fits keeps the base: the fit never zooms above it. */
export function fitZoomNeverExceedsTheBase(): void {
  expect(wallFitZoom({ base: 1.25, viewportHeight: 1080, naturalPx: 748, floor: WALL_ZOOM_FLOOR })).toBe(1.25);
}

/** Z4a — content far taller than the screen stops at the floor (0.5, owner ruling Q2); the page then scrolls. */
export function fitZoomStopsAtTheFloor(): void {
  expect(WALL_ZOOM_FLOOR).toBe(0.5);
  expect(wallFitZoom({ base: 1.25, viewportHeight: 1080, naturalPx: 5000, floor: WALL_ZOOM_FLOOR })).toBe(0.5);
}

/**
 * Z4b — no measurement is not a fit: a zero, a negative or a `NaN` height (or viewport) keeps the
 * base. Fails closed — `NaN` makes every comparison false, so an unguarded `min` would return it.
 */
export function fitZoomWithoutAMeasurementKeepsTheBase(): void {
  const fit = (viewportHeight: number, naturalPx: number) =>
    wallFitZoom({ base: 1.25, viewportHeight, naturalPx, floor: WALL_ZOOM_FLOOR });
  expect([fit(1080, 0), fit(1080, -10), fit(1080, Number.NaN), fit(Number.NaN, 1048), fit(0, 1048)]).toEqual([
    1.25, 1.25, 1.25, 1.25, 1.25,
  ]);
}

/** Z5a — a growth under the 0.05 step is ignored, so small jitter does not move the zoom. */
export function settleIgnoresASmallGrowth(): void {
  expect(settleWallZoom(1.0, 1.03, null)).toBe(1.0);
}

/** Z5b — a growth of the step or more applies. */
export function settleAppliesALargeGrowth(): void {
  expect(settleWallZoom(1.0, 1.06, null)).toBe(1.06);
}

/** Z5c — a shrink always applies, however small: the page must never overflow to hold a zoom. */
export function settleAlwaysAppliesAShrink(): void {
  expect([settleWallZoom(1.0, 0.9, null), settleWallZoom(1.0, 0.99, null)]).toEqual([0.9, 0.99]);
}

/**
 * Z5d (review finding) — a growth to the ceiling (the lowest zoom seen to overflow) or above it is
 * refused, however large: that is what stops a re-wrap jump bigger than the step from flipping
 * the zoom forever. A growth below the ceiling still applies, and a shrink ignores the ceiling.
 * Mutation: drop the ceiling clause => 1.08 for the first two => red.
 */
export function settleRefusesAGrowthToTheCeiling(): void {
  expect([
    settleWallZoom(0.98, 1.08, 1.08),
    settleWallZoom(0.98, 1.2, 1.08),
    settleWallZoom(0.98, 1.05, 1.08),
    settleWallZoom(0.98, 0.9, 1.08),
  ]).toEqual([0.98, 0.98, 1.05, 0.9]);
}

/**
 * Z6a (`F3.77` follow-up, owner ruling Q4) — a fixed-aspect tile on the wall is capped at 60 % of
 * the screen's height, in the zoomed box's CSS px: 0.6 × 1080 = 648 viewport px is 518 px at zoom
 * 1.25 (518.4) and 629 px at zoom 1.03 (629.1). Mutation: drop the division by the zoom => red.
 */
export function theAspectCapIsSixtyPercentOfTheScreen(): void {
  expect(WALL_ASPECT_CAP_FRACTION).toBe(0.6);
  expect([wallAspectCapPx(1080, 1.25), wallAspectCapPx(1080, 1.03)]).toEqual([518, 629]);
}

/**
 * Z6b — no measurement is no cap: a viewport or a zoom that is not a finite positive number gives
 * `null`, never `NaN` px or an infinite cap.
 */
export function theAspectCapWithoutAMeasurementIsNull(): void {
  expect([
    wallAspectCapPx(Number.NaN, 1.25),
    wallAspectCapPx(0, 1.25),
    wallAspectCapPx(1080, 0),
    wallAspectCapPx(1080, Number.NaN),
  ]).toEqual([null, null, null, null]);
}
