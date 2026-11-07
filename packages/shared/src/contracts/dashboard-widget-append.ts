import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";
import { chartKindIssues } from "./chart-kinds";
import {
  chartSeriesKindSchema,
  DASHBOARD_GRID,
  MAX_DASHBOARD_WIDGETS,
  MAX_WIDGET_POINTS,
  MAX_WIDGET_WINDOW_MINUTES,
  pointAggregateFunctionSchema,
} from "./dashboard-builder";
import { dashboardWidgetDtoSchema } from "./dashboard-dto";
import { MAX_DASHBOARD_TABS } from "./dashboard-tabs";
import { trendStripWidgetConfigSchema } from "./trend-strip-widget";

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 item 5) — `POST /dashboards/:id/widgets/append`: one `chart`
 * widget added at the foot of a tab.
 *
 * `widgetCapMessage` is the one declaration of the per-canvas widget cap sentence: `tabRulesHold`
 * (`dashboard-writes.ts`) and the append route's 409 both read it. It lives here, and not in
 * `dashboard-writes.ts`, because that file sits at the AGENTS.md §4.5 cap and this file must not
 * import it (a cycle).
 *
 * `appendChartWidgetResponseSchema` is a plain `z.object` over `dashboardWidgetDtoSchema`, which is
 * itself a `z.intersection` and is taken by reference (§4.8).
 *
 * `F4.306` U6 (ADR 0108 Amendment 7) — the route's second arm: `trend_strip` widgets, at most one
 * per tab (`MAX_DASHBOARD_TABS`), each replacing the tab's strip or added at its foot. The body is
 * `z.union([chart, trend])`: the chart arm has no `widgetType` and is `.strict()`, so a body that
 * names `widgetType` is never a chart, and the trend arm requires it, so a body without it is
 * never a trend. Each object is `.strict()`; `trendStripWidgetConfigSchema` is a plain `z.object`
 * (the write side composes `.strict()` through `bindsNothingArm`) and is made strict here the
 * same way. Importing `./trend-strip-widget` adds no cycle: it reaches only `../constants` and
 * `./dashboard-tabs`.
 */

/** `canvas` is a tab key, or `""` for a dashboard without tabs. */
export function widgetCapMessage(canvas: string): string {
  return canvas === ""
    ? `a dashboard without tabs holds at most ${MAX_DASHBOARD_WIDGETS} widgets`
    : `the tab "${canvas}" holds at most ${MAX_DASHBOARD_WIDGETS} widgets`;
}

/**
 * The chart arm's shape before its kind rule — `F4.324` (ADR 0108 Amendment 9 item 1). Exported
 * as a plain `ZodObject` so a caller that needs `.shape` (the copilot catalog, ADR 0099 Amendment
 * 16) reads it; every parse goes through {@link appendChartWidgetBodySchema}.
 */
export const appendChartWidgetBodyObjectSchema = z
  .object({
    tabKey: z.string().min(1).max(64).optional(),
    title: z.string().max(255).optional(),
    gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns).optional(),
    gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH).optional(),
    config: z
      .object({
        windowMinutes: z.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES),
        aggregate: pointAggregateFunctionSchema,
        // `F4.324` — the chart kind; absent is `line`, what every pin wrote before this field.
        series: chartSeriesKindSchema.optional(),
      })
      .strict(),
    points: z
      .array(
        z
          .object({
            assetId: z.string().uuid(),
            pointKey: z.string().regex(CATALOG_CODE_PATTERN),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_WIDGET_POINTS),
  })
  .strict();

/**
 * The chart arm: the object above with the shared per-kind rule (`chartKindIssues`), so a pinned
 * heatmap of two points or of a 3-day window is the same 400 as on `PUT :id/widgets`. `aggregate`
 * is required on this arm, so `compare` and `donut` always pass that rule. The controller parses
 * this arm on its own, so its field errors reach the 400; the route's `z.union` accepts it as is.
 */
export const appendChartWidgetBodySchema = appendChartWidgetBodyObjectSchema
  .superRefine((body, ctx) => {
    const { series } = body.config;
    if (series === undefined) return; // `line`, which has no kind rule
    for (const issue of chartKindIssues({ ...body.config, series }, body.points.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...issue.path], message: issue.message });
    }
  })
  // AFTER the refinement (ADR 0029 decision 10), or the document says nothing of the kind rule.
  .describe(
    "One chart widget at the foot of a tab. config.series is the chart kind (absent: line). " +
      "A compare or donut chart takes config.aggregate, which this body always carries; a heatmap " +
      "binds exactly one point over config.windowMinutes 10080 to 43200 (ADR 0047 Amendment 7).",
  );

export const appendChartWidgetResponseSchema = z.object({
  widget: dashboardWidgetDtoSchema,
  updatedAt: z.string().datetime({ offset: true }),
});

export const appendTrendStripWidgetsBodySchema = z
  .object({
    widgetType: z.literal("trend_strip"),
    strips: z
      .array(
        z
          .object({
            tabKey: z.string().min(1).max(64).optional(),
            config: trendStripWidgetConfigSchema.strict(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_DASHBOARD_TABS),
  })
  .strict();

/** The route's body: arm 0 is one `chart` widget, arm 1 is `trend_strip` widgets. */
export const appendWidgetBodySchema = z.union([appendChartWidgetBodySchema, appendTrendStripWidgetsBodySchema]);

/** The trend arm's answer: one widget per strip, in body order, and the dashboard's new stamp. */
export const appendTrendStripWidgetsResponseSchema = z.object({
  widgets: z.array(dashboardWidgetDtoSchema).min(1).max(MAX_DASHBOARD_TABS),
  updatedAt: z.string().datetime({ offset: true }),
});

export const appendWidgetResponseSchema = z.union([
  appendChartWidgetResponseSchema,
  appendTrendStripWidgetsResponseSchema,
]);
