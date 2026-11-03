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
