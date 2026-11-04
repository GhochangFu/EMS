import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";
import {
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

export const appendChartWidgetBodySchema = z
  .object({
    tabKey: z.string().min(1).max(64).optional(),
    title: z.string().max(255).optional(),
    gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns).optional(),
    gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH).optional(),
    config: z
      .object({
        windowMinutes: z.number().int().positive().max(MAX_WIDGET_WINDOW_MINUTES),
        aggregate: pointAggregateFunctionSchema,
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
