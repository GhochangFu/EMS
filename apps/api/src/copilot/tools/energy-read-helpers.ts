import { z } from "zod";

/**
 * `F4.275` — what the energy and portfolio read tools share.
 *
 * The windows are the Energy page's own three (`apps/web` `/energy`), not the
 * service's whole `<n>h | <n>d` grammar: the model asks for what an operator
 * sees on screen, and a short enum costs fewer definition characters than two
 * ranged integers.
 */
export const COPILOT_ENERGY_WINDOWS = ["24h", "7d", "30d"] as const;
export const copilotEnergyWindowSchema = z.enum(COPILOT_ENERGY_WINDOWS);
export const COPILOT_ENERGY_DEFAULT_WINDOW = "24h";

/**
 * A series tool returns at most this many buckets per organization. A 24-hour
 * source mix is 1,440 one-minute points and a 168-hour load trend 10,080, far
 * past the 8,000-character tool-result cut; 24 buckets keep one series in it.
 */
export const COPILOT_SERIES_MAX_BUCKETS = 24;

/**
 * `points` cut into at most `maxBuckets` contiguous groups of
 * `ceil(n / maxBuckets)`, each merged into one point. Never upsamples: a
 * series shorter than `maxBuckets` comes back one group per point.
 */
export function resampleSeries<T>(points: readonly T[], maxBuckets: number, merge: (group: readonly T[]) => T): T[] {
  if (points.length === 0 || maxBuckets <= 0) return [];
  const size = Math.ceil(points.length / maxBuckets);
  const out: T[] = [];
  for (let start = 0; start < points.length; start += size) {
    out.push(merge(points.slice(start, start + size)));
  }
  return out;
}

/** Two decimals, as the dashboard service rounds. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The mean of `values`, two decimals; `null` for none. */
export function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}
