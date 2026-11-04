/**
 * `F4.303` U10 — the report template and schedule-params types, each `z.infer`red from its
 * schema in `../contracts/trend-points-report` or `../contracts/reports` (ADR 0030 decision 2).
 * Re-exported by `index.ts` (§4.8: that file is at the cap).
 */
import type { z } from "zod";

import type * as R from "../contracts/reports";
import type * as TP from "../contracts/trend-points-report";

export type ReportTemplateId = z.infer<typeof R.reportTemplateIdSchema>;
export type EnergyReportParams = z.infer<typeof TP.energyReportParamsSchema>;
export type TrendPointsReportParams = z.infer<typeof TP.trendPointsReportParamsSchema>;
export type ReportScheduleParams = z.infer<typeof TP.reportScheduleParamsSchema>;
