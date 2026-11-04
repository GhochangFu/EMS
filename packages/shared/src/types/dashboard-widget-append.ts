/**
 * `F4.303` U10 — the widget-append body and response types, each `z.infer`red from its schema in
 * `../contracts/dashboard-widget-append` (ADR 0030 decision 2). Re-exported by `index.ts`.
 * `F4.306` U6 adds the `trend_strip` arm and the two unions.
 */
import type { z } from "zod";

import type * as DA from "../contracts/dashboard-widget-append";

export type AppendChartWidgetBody = z.infer<typeof DA.appendChartWidgetBodySchema>;
export type AppendChartWidgetResponse = z.infer<typeof DA.appendChartWidgetResponseSchema>;
export type AppendTrendStripWidgetsBody = z.infer<typeof DA.appendTrendStripWidgetsBodySchema>;
export type AppendTrendStripWidgetsResponse = z.infer<typeof DA.appendTrendStripWidgetsResponseSchema>;
export type AppendWidgetBody = z.infer<typeof DA.appendWidgetBodySchema>;
export type AppendWidgetResponse = z.infer<typeof DA.appendWidgetResponseSchema>;
