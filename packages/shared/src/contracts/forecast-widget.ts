import { z } from "zod";

/**
 * `E1.4c` / ADR 0135 Amendment 3 C1 — the `forecast` dashboard widget's renderer config.
 *
 * Empty (plan R11): C1 leaves `config` for renderer options and none is needed yet. The one
 * point the widget draws is a `dashboard_widget_points` row, and its unit comes from that point,
 * so nothing here names a point, a unit or a window. A plain `z.object`, so the write arm can
 * take `.strict()` of it and refuse any key a caller invents.
 */
export const forecastWidgetConfigSchema = z.object({});

export type ForecastWidgetConfig = z.infer<typeof forecastWidgetConfigSchema>;

/**
 * How many hours of actuals the widget draws before "now" (plan R10). The widget reads the
 * aggregate route for this many hours of 1-minute buckets and averages them to whole UTC hours.
 * The forecast's own 48 hours come from the forecast read, not from here.
 */
export const FORECAST_WIDGET_ACTUAL_HOURS = 24;
