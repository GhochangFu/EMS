import { HEADLINE_POINT_COUNT } from "@bms/shared/contracts";
import { encodePointRef, type GeneratedSitePointDto, type GeneratedSiteViewDto } from "@bms/shared";

import { isStale, readingTimestampMs, STALE_VALUE } from "./schematic-telemetry";

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
 * A sample with its time clamped once, when it arrived (`F4.37`): `atMs` is
 * `min(time, receivedAtMs)`. Every freshness judgement and every newer-than
 * comparison reads `atMs`, never `time`.
 */
export type ClampedLatest = PointLatest & { readonly atMs: number };

/**
 * Clamps a sample at the instant it arrived — the generated read's
 * `dataUpdatedAt`, or a socket message's receipt. A producer whose clock runs
 * ahead can then not keep a silent device fresh: clamped at render instead,
 * a future sample would read "now" on every render, forever. A sample that
 * cannot be dated is no evidence at all: `null`.
 */
export function clampSample(sample: PointLatest, receivedAtMs: number): ClampedLatest | null {
  const atMs = readingTimestampMs(sample.time, receivedAtMs);
  return atMs === null ? null : { ...sample, atMs };
}

/**
 * The newer of a point's seeded sample and a live one, by clamped time. A live
 * sample only replaces the seed when it is strictly newer, so a window-focus
 * refetch that re-supplies a newer seed is never overwritten by an older
 * socket reading, and a future-dated seed (clamped to its arrival) does not
 * block every later reading.
 */
export function overlayReading(
  seeded: ClampedLatest | null,
  live: ClampedLatest | undefined,
): ClampedLatest | null {
  if (live === undefined) {
    return seeded;
  }
  if (seeded === null) {
    return live;
  }
  return live.atMs > seeded.atMs ? live : seeded;
}

/** The generated read's samples, clamped: by `encodePointRef`, and each asset's `latestTelemetryAt` by asset id. */
export type SeededClamps = {
  readonly points: ReadonlyMap<string, ClampedLatest>;
  readonly assets: ReadonlyMap<string, { readonly time: string; readonly atMs: number }>;
};

export const NO_SEEDED_CLAMPS: SeededClamps = { points: new Map(), assets: new Map() };

/**
 * Clamps every sample of a generated read at `receivedAtMs`, the query's
 * `dataUpdatedAt`. **A sample seen before keeps its first clamp**: the 30 s
 * refetch re-supplies an unchanged sample, and re-clamping it at each refetch
 * would revive a silent, future-dated device for 25 s of every 30. A sample
 * is "the same" when its raw `time` is.
 */
export function clampSeeded(
  view: GeneratedSiteViewDto | undefined,
  receivedAtMs: number,
  previous: SeededClamps,
): SeededClamps {
  const points = new Map<string, ClampedLatest>();
  const assets = new Map<string, { readonly time: string; readonly atMs: number }>();
  for (const domain of view?.domains ?? []) {
    for (const asset of domain.assets) {
      if (asset.latestTelemetryAt !== null) {
        const before = previous.assets.get(asset.id);
        const atMs =
          before !== undefined && before.time === asset.latestTelemetryAt
            ? before.atMs
            : readingTimestampMs(asset.latestTelemetryAt, receivedAtMs);
        if (atMs !== null) {
          assets.set(asset.id, { time: asset.latestTelemetryAt, atMs });
        }
      }
      for (const point of asset.points) {
        if (point.latest === null) {
          continue;
        }
        const ref = encodePointRef(asset.id, point.pointKey);
        const before = previous.points.get(ref);
        const clamped =
          before !== undefined && before.time === point.latest.time
            ? { ...point.latest, atMs: before.atMs }
            : clampSample(point.latest, receivedAtMs);
        if (clamped !== null) {
          points.set(ref, clamped);
        }
      }
    }
  }
  return { points, assets };
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
