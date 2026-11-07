import type { z } from "zod";

import type { chartConfigSchema, chartSeriesKindSchema } from "./dashboard-builder";

/**
 * `F4.323` / ADR 0047 Amendment 7 item 7 — the per-kind rules of the generic `chart` widget,
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
 * The kinds that read through the aggregate and draw nothing without it: `compare` and `donut`
 * draw one number per point (owner ruling Q2, 2026-11-07); `heatmap` reads its hourly cells with
 * it as the bucket function (Amendment 7 item 5, drafter choice).
 */
export const CHART_KINDS_NEEDING_AGGREGATE = ["compare", "donut", "heatmap"] as const satisfies readonly ChartSeriesKind[];

/**
 * `F4.323` PR 2 (Amendment 7 item 5) — the heatmap's window, 7 to 30 days. This is exactly the
 * `1h` rung of the aggregate read's ladder (`apps/api/src/telemetry/point-aggregate-window.ts`:
 * above 2,880 minutes and up to 43,200), so every accepted window is read in hourly buckets;
 * `heatmap-window.spec.ts` in `apps/api` holds the two together.
 */
export const HEATMAP_MIN_WINDOW_MINUTES = 10_080;
export const HEATMAP_MAX_WINDOW_MINUTES = 43_200;

export const HEATMAP_ONE_POINT_MESSAGE = "a heatmap chart binds exactly one point";

export const HEATMAP_WINDOW_MESSAGE =
  `a heatmap chart needs config.windowMinutes from ${HEATMAP_MIN_WINDOW_MINUTES} to ` +
  `${HEATMAP_MAX_WINDOW_MINUTES} (7 to 30 days), the window read in hourly buckets`;

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
  // The three write paths pass the real count; the builder form passes 0 and checks the count
  // where it sees the points (`chartPointIssues`, `widget-config-form.ts`).
  pointCount: number,
): ChartKindIssue[] {
  const issues: ChartKindIssue[] = [];
  if ((CHART_KINDS_NEEDING_AGGREGATE as readonly ChartSeriesKind[]).includes(config.series) && !config.aggregate) {
    issues.push({ path: ["config", "aggregate"], message: chartKindAggregateMessage(config.series) });
  }
  if (config.series === "heatmap") {
    // More than one only: zero points is each path's own rule (the live path's minimum, a
    // template's unresolved binding), not this kind's.
    if (pointCount > 1) {
      issues.push({ path: ["points"], message: HEATMAP_ONE_POINT_MESSAGE });
    }
    const w = config.windowMinutes;
    if (w === undefined || w < HEATMAP_MIN_WINDOW_MINUTES || w > HEATMAP_MAX_WINDOW_MINUTES) {
      issues.push({ path: ["config", "windowMinutes"], message: HEATMAP_WINDOW_MESSAGE });
    }
  }
  return issues;
}
