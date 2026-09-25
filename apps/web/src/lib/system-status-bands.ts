import type { SystemComponentKey, SystemStatusResponse } from "@bms/shared";

/**
 * `F3.30` (ADR 0075 decision 5) — Good/Fair/Poor bands for `dataQuality.percent`,
 * and the two summary strings the footer indicator renders. Owner-confirmed
 * wording, 2026-09-25: labels "Job queue", "Object storage", "Field data";
 * bands Good ≥ 95, Fair ≥ 80, Poor below.
 */

/** `good`/`fair` are the lower bound of their band; below `fair` is `poor`. */
export const DATA_QUALITY_BANDS = { good: 95, fair: 80 } as const;

export type SystemQualityBand = "good" | "fair" | "poor";

/** The label each component key renders under in the footer. */
export const SYSTEM_COMPONENT_LABELS: Record<SystemComponentKey, string> = {
  queue: "Job queue",
  storage: "Object storage",
  field_data: "Field data",
};

/**
 * `null` in, `null` out (`dataQuality.percent` is `null` when there is
 * nothing to measure — see the contract's docblock).
 *
 * **Fails closed on `NaN`.** A `NaN` is neither `>= good` nor `>= fair`, so
 * without an explicit check it would fall through to `"poor"` — which reads
 * as a real, measured worst case rather than "this number is not usable".
 * `null` is the honest answer for "cannot band this", matching the contract's
 * own `null`-for-nothing-to-measure convention.
 */
export function dataQualityBand(percent: number | null): SystemQualityBand | null {
  if (percent === null || Number.isNaN(percent)) {
    return null;
  }
  if (percent >= DATA_QUALITY_BANDS.good) {
    return "good";
  }
  if (percent >= DATA_QUALITY_BANDS.fair) {
    return "fair";
  }
  return "poor";
}

/** `"All systems operational"`, or `"Degraded: <label>, <label>"` in component order. */
export function summaryLine(body: SystemStatusResponse): string {
  const degraded = body.components
    .filter((c) => c.state === "degraded")
    .map((c) => SYSTEM_COMPONENT_LABELS[c.key]);
  return degraded.length === 0 ? "All systems operational" : `Degraded: ${degraded.join(", ")}`;
}

/**
 * `"Job queue: ok · Object storage: not configured · Field data: degraded"`
 * — every component, in the contract's fixed order, underscore in the state
 * replaced by a space.
 */
export function titleLine(body: SystemStatusResponse): string {
  return body.components
    .map((c) => `${SYSTEM_COMPONENT_LABELS[c.key]}: ${c.state.replace(/_/g, " ")}`)
    .join(" · ");
}
