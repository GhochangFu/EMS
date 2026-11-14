import type { LocationKpiSummary } from "@bms/shared";

/**
 * `F4.364` (ADR 0133 decision 4) — the kW figure's text. The summary's `totalKw` is `null` when
 * energy is not shown or no asset has a `kw` value, and that reads `—`, never `0.0`.
 */
export function kwText(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

/** The card's first figure: its text and the word under it. */
export interface CardFigure {
  value: string;
  label: string;
}

/**
 * `F4.364` (ADR 0133 decision 3, plan D10) — the location card's first figure for the API's
 * resolved `primaryMetric`: kW to one decimal; the asset health score as a whole percentage (`—`,
 * never `0%`, when nothing is scored); the open critical alarms; `null` for `none` (the card then
 * shows two figures).
 */
export function primaryFigure(location: LocationKpiSummary): CardFigure | null {
  switch (location.primaryMetric) {
    case "kw":
      return { value: kwText(location.totalKw), label: "kW" };
    case "health":
      return {
        value: location.healthScore === null ? "—" : `${Math.round(location.healthScore * 100)}%`,
        label: "health",
      };
    case "critical_alarms":
      return { value: String(location.criticalAlarms), label: "critical" };
    case "none":
      return null;
  }
}
