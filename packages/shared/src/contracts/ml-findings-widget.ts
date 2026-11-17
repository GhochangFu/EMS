import { z } from "zod";

/**
 * `E1.9f` / ADR 0135 Amendment 8 decision 13 — what an `ml_findings` widget shows: both kinds of
 * findings, or one. The builder writes `"both"` for a new widget.
 */
export const ML_FINDINGS_WIDGET_SHOW = ["both", "forecasts", "anomalies"] as const;

export type MlFindingsWidgetShow = (typeof ML_FINDINGS_WIDGET_SHOW)[number];

/**
 * The `ml_findings` dashboard widget's renderer config (ADR 0135 Amendment 8 decision 13).
 *
 * Renderer options only. The widget binds no point and no source: its scope is its dashboard's
 * own organization plus the one of location, asset group or asset that the dashboard names.
 *
 * Both keys are optional and there is **no `.default()`** (plan R-u): a default would make the
 * schema's input and output types differ (the ADR 0030 trap). The builder always writes both; the
 * renderer reads `show ?? "both"` and `paragraph ?? true`. `paragraph: false` shows the facts only
 * and never asks for a paragraph. A plain `z.object`, so the write arm takes `.strict()` of it and
 * refuses any key a caller invents.
 */
export const mlFindingsWidgetConfigSchema = z.object({
  show: z.enum(ML_FINDINGS_WIDGET_SHOW).optional(),
  paragraph: z.boolean().optional(),
});

export type MlFindingsWidgetConfig = z.infer<typeof mlFindingsWidgetConfigSchema>;
