import { expect } from "vitest";

import { FRESH_MS } from "./schematic-telemetry";
import {
  formatWallTime,
  newestReadMs,
  nextTabKey,
  parseWallParams,
  WALL_DEFAULT_S,
  wallBar,
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
    }),
  ).toBe(t2);
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: new Date(t2).toISOString() }]]),
      catalogResolvedAt: null,
      siteWidgetsUpdatedAt: undefined,
    }),
  ).toBe(t2);
}

/** W6 — no read at all, a never-updated query (`0`) and an unparsable time are no evidence. */
export function newestReadIgnoresWhatIsNoEvidence(): void {
  expect(newestReadMs({ latestByRef: new Map(), catalogResolvedAt: null, siteWidgetsUpdatedAt: undefined })).toBeNull();
  expect(newestReadMs({ latestByRef: new Map(), catalogResolvedAt: null, siteWidgetsUpdatedAt: 0 })).toBeNull();
  const t1 = Date.UTC(2026, 9, 2, 4, 0, 0);
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: "not a time" }]]),
      catalogResolvedAt: "garbage",
      siteWidgetsUpdatedAt: t1,
    }),
  ).toBe(t1);
  expect(
    newestReadMs({
      latestByRef: new Map([["a", { value: 1, time: "not a time" }]]),
      catalogResolvedAt: "garbage",
      siteWidgetsUpdatedAt: Number.NaN,
    }),
  ).toBeNull();
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
