export interface CalcInputSample {
  value: number;
  timeMs: number;
}

export type InputClassification = "fresh" | "stale" | "missing";

/**
 * Classifies one formula input against its formula's own staleness budget
 * (ADR 0037 decision 5). Runs in code, not in the query that fetched
 * `sample`: `CalcInputsService` (task 8) reads with a bound looser than
 * `maxInputAgeSeconds` on purpose, so "never reported" (`missing`, `sample`
 * is `undefined`) and "reported, but too long ago" (`stale`) stay
 * distinguishable here instead of collapsing into the same empty result.
 *
 * Exactly at the boundary (`ageMs === maxInputAgeSeconds * 1000`) counts as
 * `fresh` — the budget is inclusive of its own edge.
 */
export function classifyInput(
  sample: CalcInputSample | undefined,
  nowMs: number,
  maxInputAgeSeconds: number,
): InputClassification {
  if (!sample) {
    return "missing";
  }
  return nowMs - sample.timeMs > maxInputAgeSeconds * 1000 ? "stale" : "fresh";
}

/** The newest `timeMs` among `samples`, or `null` for an empty list — the
 * streaming host's output timestamp (ADR 0037 decision 8). */
export function newestTimeMs(samples: readonly CalcInputSample[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  return samples.reduce((max, sample) => Math.max(max, sample.timeMs), -Infinity);
}
