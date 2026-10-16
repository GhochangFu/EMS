import type { SiteLiveReadings } from "../hooks/use-site-live-readings";

/**
 * `F3.87` PR 5 — the readings of a drawing with no live data: the layout
 * editor's canvas, the "Start from" preview and the copilot's layout card.
 * Every roled unit reads as "Not assigned". One constant for the three, where
 * the first two each held a copy.
 */
export const NO_READINGS: SiteLiveReadings = {
  nowMs: 0,
  pointLatest: () => null,
  assetLastSeenMs: () => null,
};
