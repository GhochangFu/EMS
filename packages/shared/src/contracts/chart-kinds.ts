import type { z } from "zod";

import type { chartConfigSchema, chartSeriesKindSchema } from "./dashboard-builder";

/**
 * `F4.322` / ADR 0047 Amendment 7 item 7 — the per-kind rules of the generic `chart` widget,
 * stated once and called by every surface that writes a chart config: the live dashboard
 * `PUT :id/widgets` body (`dashboard-writes.ts`), the asset-template default dashboard
 * (`asset-template-content-writes.ts`) and the section / site template widget
 * (`dashboard-templates.ts`). Pure: config and the number of bound points in, issues out, so
 * each caller adds them under its own path prefix and the three cannot drift.
 *
 * A kind rule, not a type cardinality: `WIDGET_POINT_CARDINALITY.chart` is unchanged.
 */

type ChartSeriesKind = z.infer<typeof chartSeriesKindSchema>;
type ChartConfig = z.infer<typeof chartConfigSchema>;

/**
 * The kinds that draw one number per point — the point's `aggregate` over `windowMinutes` —
 * so they have nothing to draw without one (owner ruling Q2, 2026-11-07).
 */
export const CHART_KINDS_NEEDING_AGGREGATE = ["compare", "donut"] as const satisfies readonly ChartSeriesKind[];

/** The refusal of a kind in {@link CHART_KINDS_NEEDING_AGGREGATE} saved without `config.aggregate`. */
export const chartKindAggregateMessage = (kind: ChartSeriesKind): string =>
  `a ${kind} chart needs config.aggregate (sum, avg, min or max): it draws one number per point`;

/** One refusal, its path relative to the widget (`["config", "aggregate"]`, `["points"]`). */
export interface ChartKindIssue {
  readonly path: readonly string[];
  readonly message: string;
}

/** Every per-kind rule the config breaks, given how many points the widget binds. */
export function chartKindIssues(
  config: Pick<ChartConfig, "series" | "aggregate" | "windowMinutes">,
  // Unused until the heatmap's point rule (`F4.322` PR 2). The three write paths pass the real
  // count; the builder form passes 0 here and checks the count where it sees the points.
  _pointCount: number,
): ChartKindIssue[] {
  const issues: ChartKindIssue[] = [];
  if ((CHART_KINDS_NEEDING_AGGREGATE as readonly ChartSeriesKind[]).includes(config.series) && !config.aggregate) {
    issues.push({ path: ["config", "aggregate"], message: chartKindAggregateMessage(config.series) });
  }
  return issues;
}
