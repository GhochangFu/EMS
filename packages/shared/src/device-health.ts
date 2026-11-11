/**
 * `F3.16` / ADR 0127 decisions 8, 16 and 17 — the device-health vocabulary and
 * numbers, declared once. No `zod` and no import, so `apps/ingest` (which
 * counts the drops) and the API and web (which read them) share one list
 * through the package barrel (`apps/api` resolves with `moduleResolution:
 * "node"`, which ignores the `exports` map).
 */

/**
 * Why a sample was dropped before it reached `telemetry.point_values`
 * (ADR 0127 decision 8). Migration `0149`'s `reason` CHECKs hold this same list
 * in this order; `tests/f3.16-device-health-schema.test.ts` pins the two together.
 */
export const DROP_REASONS = [
  "badQuality",
  "nonFinite",
  "unknownDevice",
  "unmappedSourceKey",
  "ambiguousDevice",
  "outOfRange",
] as const;

export type DropReason = (typeof DROP_REASONS)[number];

/** The ingest host is stale after this many seconds with no heartbeat (decision 16). */
export const INGEST_HOST_STALE_SECONDS = 30;

/** An RTU is Stale from this fraction of its offline window, Offline past it (decision 16). */
export const STALE_BAND_FRACTION = 0.6;

/** Clock skew is highlighted beyond plus or minus this many seconds; no alarm on skew (decision 16). */
export const CLOCK_SKEW_HIGHLIGHT_SECONDS = 300;
