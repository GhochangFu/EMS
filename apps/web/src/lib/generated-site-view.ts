import { HEADLINE_POINT_COUNT } from "@bms/shared/contracts";
import type { GeneratedSitePointDto } from "@bms/shared";

import { isStale, STALE_VALUE } from "./schematic-telemetry";

/**
 * `F3.68` U6 — the pure half of `GeneratedSiteView` (ADR 0076 decision 7).
 *
 * No freshness window and no timer live here: the window is `FRESH_MS` behind
 * `isStale`, and the tick is `useSiteLiveReadings`'s one `STALE_TICK_MS`
 * interval (ADR 0027 decisions 6 and 7).
 */

/** One point's newest sample. */
export type PointLatest = NonNullable<GeneratedSitePointDto["latest"]>;

/** An asset's live status — the API's `freshness` vocabulary (D3). */
export type AssetStatus = "live" | "stale" | "none";

/**
 * The points a card shows: the first `HEADLINE_POINT_COUNT` of the server's
 * order (D1, D6), or every point once "All points" expands it (OQ2). Never
 * re-sorted — the server's `headline_rank ASC NULLS LAST, point_key ASC` is
 * the one ordering rule.
 */
export function headlinePoints(
  points: readonly GeneratedSitePointDto[],
  expanded: boolean,
): readonly GeneratedSitePointDto[] {
  return expanded ? points : points.slice(0, HEADLINE_POINT_COUNT);
}

/**
 * The newer of a point's seeded sample and a live one. A live sample only
 * replaces the seed when it is strictly newer, so a window-focus refetch that
 * re-supplies a newer seed is never overwritten by an older socket reading,
 * and a reading that cannot be dated is no evidence at all.
 */
export function overlayReading(
  seeded: PointLatest | null,
  live: PointLatest | undefined,
): PointLatest | null {
  if (live === undefined) {
    return seeded;
  }
  const liveMs = Date.parse(live.time);
  if (Number.isNaN(liveMs)) {
    return seeded;
  }
  if (seeded === null) {
    return live;
  }
  const seededMs = Date.parse(seeded.time);
  return Number.isNaN(seededMs) || liveMs > seededMs ? live : seeded;
}

/**
 * An asset's status from its newest registered-point sample (D3): no sample
 * is `none`, and otherwise the shared gate decides — `isStale` is the only
 * freshness rule in the web client (ADR 0027).
 */
export function assetStatus(lastSeenMs: number | null, nowMs: number): AssetStatus {
  if (lastSeenMs === null) {
    return "none";
  }
  return isStale(lastSeenMs, nowMs) ? "stale" : "live";
}

/** A point value for a card row: the shared dash for no sample, else at most two decimals. */
export function formatPointValue(value: number | null): string {
  if (value === null) {
    return STALE_VALUE;
  }
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
