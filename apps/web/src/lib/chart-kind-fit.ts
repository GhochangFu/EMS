import { chartKindIssues } from "@bms/shared";
import type { ChartSeriesKind } from "@bms/shared";

import { CHART_SERIES } from "./widget-catalog";

/**
 * `F4.324` (ADR 0108 Amendment 9 items 2 and 3) — whether a chart kind fits a view that the Pin
 * dialog or the trend strip wizard turns into a chart, and the plain words when it does not.
 *
 * **The rule is the shared one** (`chartKindIssues`), asked with the view's point count and window
 * and a function present (both callers always send one), so the disabled option and the API's
 * 400 cannot disagree. Only the heatmap can fail that way today; its sentence is the one reason.
 */

/** The reason a heatmap does not fit: its window is 7–30 days and it binds one point. */
export const HEATMAP_FIT_REASON = "Needs a 7–30 day view of one point";

/** `F4.325` (ADR 0047 Amendment 8 item 2) — the reason a matrix does not fit: it reads the last day. */
export const MATRIX_FIT_REASON = "Needs a 24-hour view";

/** What a caller knows of the view it is about to chart. */
export interface ChartViewShape {
  readonly pointCount: number;
  readonly windowMinutes: number;
}

/** `null` when the kind fits the view, else the sentence shown beside the disabled option. */
export function chartKindFitReason(kind: ChartSeriesKind, view: ChartViewShape): string | null {
  const issues = chartKindIssues({ series: kind, aggregate: "avg", windowMinutes: view.windowMinutes }, view.pointCount);
  if (issues.length === 0) return null;
  // The heatmap's plain sentence; any later kind's rule shows its own message, never this one.
  if (kind === "heatmap") return HEATMAP_FIT_REASON;
  if (kind === "matrix") return MATRIX_FIT_REASON;
  return issues[0]?.message ?? null;
}

/** One option of a Chart kind select: the catalog's label, and why it is disabled (`null` if not). */
export interface ChartKindChoice {
  readonly value: ChartSeriesKind;
  readonly label: string;
  readonly disabledReason: string | null;
}

/** Every kind, in `CHART_SERIES` order, each with its fit for this view (owner ruling Q2: shown, not hidden). */
export function chartKindChoices(view: ChartViewShape): ChartKindChoice[] {
  return (Object.keys(CHART_SERIES) as ChartSeriesKind[]).map((value) => ({
    value,
    label: CHART_SERIES[value].label,
    disabledReason: chartKindFitReason(value, view),
  }));
}
