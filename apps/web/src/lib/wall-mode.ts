import type { LatestByRef } from "./dashboard-widget-data";
import { isStale } from "./schematic-telemetry";

/**
 * `F3.77` (ADR 0087 Amendment 3 ruling 7, plan D7) — the pure rules of the site view's wall mode.
 *
 * The wall URL is the site route with its tab in the path segment (owner ruling OQ2) plus
 * `?wall=1&every=<seconds>`: `/control-room/site/<id>/<tab>?wall=1&every=30`. `wall` is on only
 * for exactly `"1"` — the same rule `return-path.ts`'s `rememberWallReturnPath` applies before it
 * keeps a URL across a sign-in. `every` is one of {@link WALL_INTERVALS_S}; anything else reads as
 * {@link WALL_DEFAULT_S}, so a hand-edited URL never stalls or spins the rotation.
 */
export const WALL_INTERVALS_S = [15, 30, 60, 120] as const;

export type WallIntervalS = (typeof WALL_INTERVALS_S)[number];

export const WALL_DEFAULT_S: WallIntervalS = 30;

export type WallParams = { readonly on: boolean; readonly everyS: WallIntervalS };

export function parseWallParams(search: string): WallParams {
  const params = new URLSearchParams(search);
  const every = Number(params.get("every"));
  const everyS = WALL_INTERVALS_S.find((interval) => interval === every) ?? WALL_DEFAULT_S;
  return { on: params.get("wall") === "1", everyS };
}

/** The tab's path under the site (`siteTabHref`'s rule), or the bare site path for no tab. */
export function wallTabPath(sitePath: string, tabKey: string | undefined): string {
  return tabKey === undefined ? sitePath : `${sitePath}/${encodeURIComponent(tabKey)}`;
}

/** The wall URL of one tab. No tab is the bare site path, which shows the first tab. */
export function wallHref(sitePath: string, tabKey: string | undefined, everyS: WallIntervalS): string {
  return `${wallTabPath(sitePath, tabKey)}?wall=1&every=${everyS}`;
}

/**
 * The tab after `current` in `keys` (the dashboard's tabs by `sortOrder`), wrapping to the first:
 * every tab gets one turn per round. `undefined` is the bare path, which shows the first tab, so
 * its next is the second — the first turn never re-selects the tab already on screen. A key not
 * in the list restarts at the first. `null` when there is no tab.
 */
export function nextTabKey(keys: readonly string[], current: string | undefined): string | null {
  if (keys.length === 0) {
    return null;
  }
  const index = current === undefined ? 0 : keys.indexOf(current);
  return keys[(index + 1) % keys.length] ?? null;
}

export type NewestReadSamples = {
  /** The canvas's latest socket or seeded sample per point (`useDashboardTelemetry`). */
  readonly latestByRef: LatestByRef;
  /** The catalog read's `resolvedAt` (`useDashboardTelemetry`'s `catalog`), `null` if none. */
  readonly catalogResolvedAt: string | null;
  /** The tab's site-widgets query `dataUpdatedAt`; `0` or `undefined` when it never answered. */
  readonly siteWidgetsUpdatedAt: number | undefined;
};

/**
 * `F3.77` plan D9 (owner ruling OQ5) — the newest read the canvas holds, in epoch ms, or `null`
 * when it holds none. Only finite, positive times count: an unparsable time is no evidence of
 * freshness, a query that never answered reports `dataUpdatedAt` `0`, and one `NaN` in a
 * `Math.max` would make the result `NaN` — which `isStale` reads as fresh. A time ahead of the
 * clock is kept as it is (not clamped), so `isStale`'s `lastSeenMs > nowMs` clause reads it as
 * stale: the bar fails closed, never open.
 */
export function newestReadMs(samples: NewestReadSamples): number | null {
  const times: number[] = [];
  for (const reading of samples.latestByRef.values()) {
    if (reading !== null) {
      times.push(Date.parse(reading.time));
    }
  }
  if (samples.catalogResolvedAt !== null) {
    times.push(Date.parse(samples.catalogResolvedAt));
  }
  if (samples.siteWidgetsUpdatedAt !== undefined) {
    times.push(samples.siteWidgetsUpdatedAt);
  }
  const evidence = times.filter((time) => Number.isFinite(time) && time > 0);
  return evidence.length === 0 ? null : Math.max(...evidence);
}

export type WallBarState =
  | { readonly kind: "live"; readonly updatedAt: number }
  | { readonly kind: "paused"; readonly since: number | null };

/**
 * The top bar's data line: live while the newest read passes `isStale` (`FRESH_MS`, the one
 * stale rule of the web client), else "Live data paused since <the newest read>". No read at all
 * is paused with no time.
 */
export function wallBar(newestMs: number | null, nowMs: number): WallBarState {
  if (newestMs === null || isStale(newestMs, nowMs)) {
    return { kind: "paused", since: newestMs };
  }
  return { kind: "live", updatedAt: newestMs };
}

/** Local `hh:mm:ss`, 24-hour and zero padded, whatever the browser's locale. */
export function formatWallTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
