/**
 * `F4.303` U10 — the widget-append body and response types, each `z.infer`red from its schema in
 * `../contracts/dashboard-widget-append` (ADR 0030 decision 2). Re-exported by `index.ts`.
 */
import type { z } from "zod";

import type * as DA from "../contracts/dashboard-widget-append";

export type AppendChartWidgetBody = z.infer<typeof DA.appendChartWidgetBodySchema>;
export type AppendChartWidgetResponse = z.infer<typeof DA.appendChartWidgetResponseSchema>;
