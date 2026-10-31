/**
 * `F4.300` / ADR 0108 — the trend-point response and body types, each
 * `z.infer`red from its schema in `../contracts/trend-points` (ADR 0030
 * decision 2). Re-exported by `index.ts` (§4.8: that file is at the cap).
 */
import type { z } from "zod";

import type * as TP from "../contracts/trend-points";

export type TrendPointDto = z.infer<typeof TP.trendPointSchema>;
export type TrendPointSegmentDto = z.infer<typeof TP.trendPointSegmentSchema>;
export type OrgTrendPointsDto = z.infer<typeof TP.orgTrendPointsDtoSchema>;
export type SiteTrendPointsDto = z.infer<typeof TP.siteTrendPointsDtoSchema>;
export type PutOrgTrendPointsBody = z.infer<typeof TP.putOrgTrendPointsBodySchema>;
