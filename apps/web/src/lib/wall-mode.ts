import type { LatestByRef } from "./dashboard-widget-data";
import { isStale, readingTimestampMs } from "./schematic-telemetry";

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
 * `Math.max` would make the result `NaN` — which `isStale` reads as fresh.
 *
 * **A time ahead of `nowMs` is clamped to it (`F4.37`)** — the sample times and the catalog read
 * through `readingTimestampMs`, the helper `widgetDataFor` reads the same samples with, so the bar
 * and the tiles beside it agree. Unclamped, a producer or server clock ahead of the wall PC wins
 * the `Math.max` and `isStale`'s `lastSeenMs > nowMs` clause reads it as stale: "Live data paused
 * since <a future time>" beside live tiles (`schematic-telemetry.ts`: treating a future time as
 * instantly stale "breaks the live pilot").
 */
export function newestReadMs(samples: NewestReadSamples, nowMs: number): number | null {
  const times: number[] = [];
  for (const reading of samples.latestByRef.values()) {
    if (reading !== null) {
      times.push(readingTimestampMs(reading.time, nowMs) ?? Number.NaN);
    }
  }
  if (samples.catalogResolvedAt !== null) {
    times.push(readingTimestampMs(samples.catalogResolvedAt, nowMs) ?? Number.NaN);
  }
  if (samples.siteWidgetsUpdatedAt !== undefined) {
    times.push(Math.min(samples.siteWidgetsUpdatedAt, nowMs));
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
 *
 * The read is clamped to `nowMs` here too: the canvas reports it clamped to its own render-time
 * clock, and the frame judges it on a one-second tick that can be up to a second behind — so an
 * honest read can still be ahead of `nowMs`, and must not read as paused until the next tick.
 */
export function wallBar(newestMs: number | null, nowMs: number): WallBarState {
  const read = newestMs === null ? null : Math.min(newestMs, nowMs);
  if (read === null || isStale(read, nowMs)) {
    return { kind: "paused", since: read };
  }
  return { kind: "live", updatedAt: read };
}

/** Local `hh:mm:ss`, 24-hour and zero padded, whatever the browser's locale. */
export function formatWallTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * `F3.77` follow-up (plan D5, owner ruling Q2) — the wall's zoom is computed, not a stylesheet
 * constant: the base scale for the screen's width, then reduced so the whole page fits one screen.
 *
 * `zoom` (not a root `font-size`) because many widget sizes are px literals (`text-[11px]`), which
 * a root size would leave alone. The wall PCs run Chrome or Edge; Firefox before 126 ignores
 * `zoom`. `WallFrame` sets it inline on `[data-wall-root]`; it is the one source.
 */
export const WALL_WIDE_SCREEN_PX = 3000;

/** Below 0.5 the type is unreadable: the fit stops here and the page scrolls (owner ruling Q2). */
export const WALL_ZOOM_FLOOR = 0.5;

/**
 * A growth smaller than this is ignored, so small jitter in the measured height does not move the
 * zoom. It does not stop a re-wrap two-cycle on its own — a jump larger than the step passes it;
 * the overflow ceiling in {@link settleWallZoom} does.
 */
export const WALL_ZOOM_GROWTH_STEP = 0.05;

/** The base zoom: 1.25 on a 1920 px wall, 2.5 from {@link WALL_WIDE_SCREEN_PX} (a 4K wall). */
export function wallBaseZoom(viewportWidth: number): number {
  return viewportWidth >= WALL_WIDE_SCREEN_PX ? 2.5 : 1.25;
}

export type WallFitInput = {
  readonly base: number;
  /** `window.innerHeight`, in viewport px. */
  readonly viewportHeight: number;
  /** The bar's plus the content's `offsetHeight`: unscaled CSS px, the same at any zoom. */
  readonly naturalPx: number;
  readonly floor: number;
};

/**
 * The largest zoom, at most `base`, at which `naturalPx` fits `viewportHeight`, floored to two
 * decimals (never rounded up, which could overflow by a pixel) and never below `floor`.
 *
 * **No measurement is not a fit.** A height or a viewport that is not a finite positive number
 * keeps `base`: `NaN` makes every comparison false, so an unguarded `Math.min` would return it.
 */
export function wallFitZoom({ base, viewportHeight, naturalPx, floor }: WallFitInput): number {
  if (!(Number.isFinite(naturalPx) && naturalPx > 0 && Number.isFinite(viewportHeight) && viewportHeight > 0)) {
    return base;
  }
  const fit = Math.floor((viewportHeight / naturalPx) * 100) / 100;
  return Math.max(floor, Math.min(base, fit));
}

/**
 * The zoom to apply next. A shrink always applies (the page must not overflow to keep a zoom); a
 * growth applies only when it is at least {@link WALL_ZOOM_GROWTH_STEP} **and** stays below
 * `ceiling`, the lowest zoom at which the content has been seen to overflow (`null` for none).
 *
 * A zoom change re-wraps the content, which changes its height, which changes the fit. When the
 * jump is larger than the step, the step alone lets the zoom flip between two values for ever
 * (overflow at the high one, room at the low one). The ceiling fails closed: once a zoom has
 * overflowed, the fit never grows back to it, so the zoom settles at the lower value. The caller
 * clears the ceiling when the conditions change (a window resize, a new tab).
 */
export function settleWallZoom(current: number, target: number, ceiling: number | null): number {
  if (target <= current) {
    return target;
  }
  if (target - current < WALL_ZOOM_GROWTH_STEP || (ceiling !== null && target >= ceiling)) {
    return current;
  }
  return target;
}

/**
 * The share of the screen's height a fixed-aspect tile (the mimic) may take on the wall (owner
 * ruling Q4). A full-width drawing's height follows its width, which `zoom` does not change in
 * viewport px, so zoom alone cannot fit it; the cap letterboxes it instead.
 */
export const WALL_ASPECT_CAP_FRACTION = 0.6;

/**
 * The fixed-aspect cap in the zoomed box's CSS px: {@link WALL_ASPECT_CAP_FRACTION} of the
 * viewport's height, divided by the zoom, so the tile is that share of the screen whatever the
 * zoom. Constant in viewport px, so the fit still converges. `null` (no cap) for a viewport or a
 * zoom that is not a finite positive number.
 */
export function wallAspectCapPx(viewportHeight: number, zoom: number): number | null {
  if (!(Number.isFinite(viewportHeight) && viewportHeight > 0 && Number.isFinite(zoom) && zoom > 0)) {
    return null;
  }
  return Math.round((WALL_ASPECT_CAP_FRACTION * viewportHeight) / zoom);
}
