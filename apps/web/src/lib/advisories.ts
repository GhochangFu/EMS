import type { AdvisoryConfidence, AdvisoryKind } from "@bms/shared/contracts";

/**
 * `E1.6b` / ADR 0137 (plan T2.1) — the pure helpers of the advisories page and card. The
 * sentences and numbers arrive built from the server (R-f); the browser only names the kind and
 * the confidence, and says when the meter list was capped (R-e).
 */

const KIND_LABELS: Record<AdvisoryKind, string> = {
  low_power_factor: "Low power factor",
  excess_consumption: "Consumption above baseline",
  demand_near_contract: "Forecast demand near contract",
};

const CONFIDENCE_LABELS: Record<AdvisoryConfidence, string> = {
  measured: "Measured",
  estimated: "Estimated",
  forecast_based: "Forecast-based",
};

/** The card's title. */
export function advisoryKindLabel(kind: AdvisoryKind): string {
  return KIND_LABELS[kind];
}

/** How sure the figure is, as the card names it. */
export function advisoryConfidenceLabel(confidence: AdvisoryConfidence): string {
  return CONFIDENCE_LABELS[confidence];
}

/** Read again every 15 minutes; the window is whole local days, so this is generous. */
export const ADVISORIES_REFETCH_MS = 15 * 60_000;

/** "Showing <considered> of <candidates> meters." when the server capped the list, else `null`. */
export function shownOfSentence(considered: number, candidates: number): string | null {
  return considered < candidates ? `Showing ${considered} of ${candidates} meters.` : null;
}
