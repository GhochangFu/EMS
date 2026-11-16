import { z } from "zod";

/**
 * `E1.2d` / ADR 0135 Amendment 5 ruling 4(c) — the `anomaly` dashboard widget's renderer config.
 *
 * Empty (plan R16): the one point bound through `dashboard_widget_points` names the asset whose
 * anomaly score the widget draws, and is not itself drawn, so nothing here names a point, a unit
 * or a window. A plain `z.object`, so the write arm can take `.strict()` of it and refuse any key
 * a caller invents.
 */
export const anomalyWidgetConfigSchema = z.object({});

export type AnomalyWidgetConfig = z.infer<typeof anomalyWidgetConfigSchema>;

/**
 * How many hours of anomaly score the widget draws before "now" (ruling 4(c): the last 7 days).
 * The widget reads `GET /ml/assets/:assetId/anomalies` for this window and seeds every UTC hour
 * of it, so an unscored hour is a gap.
 */
export const ANOMALY_WIDGET_HOURS = 168;
