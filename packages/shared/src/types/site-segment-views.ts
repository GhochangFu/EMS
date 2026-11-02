/**
 * `F4.302` / ADR 0108 Amendment 4 — the segment-views query and response types, each `z.infer`red
 * from its schema in `../contracts/site-segment-views` (ADR 0030 decision 2). Re-exported by
 * `index.ts` (§4.8: that file is near the cap).
 */
import type { z } from "zod";

import type * as SV from "../contracts/site-segment-views";

export type SiteSegmentViewsQuery = z.infer<typeof SV.siteSegmentViewsQuerySchema>;
export type SegmentViewPeriodDto = z.infer<typeof SV.segmentViewPeriodSchema>;
export type SegmentViewSegmentRefDto = z.infer<typeof SV.segmentViewSegmentRefSchema>;
export type SegmentViewSegmentDto = z.infer<typeof SV.segmentViewSegmentSchema>;
export type SegmentViewPointDto = z.infer<typeof SV.segmentViewPointSchema>;
export type SegmentViewStatsDto = z.infer<typeof SV.segmentViewStatsSchema>;
export type SegmentViewRankingEntryDto = z.infer<typeof SV.segmentViewRankingEntrySchema>;
export type SegmentAbnormalVerdict = z.infer<typeof SV.segmentAbnormalVerdictSchema>;
export type SegmentAbnormalEntryDto = z.infer<typeof SV.segmentAbnormalEntrySchema>;
export type SegmentAbnormalBaselineDto = z.infer<typeof SV.segmentAbnormalBaselineSchema>;
export type SegmentAbnormalDto = z.infer<typeof SV.segmentAbnormalSchema>;
export type SiteSegmentViewsDto = z.infer<typeof SV.siteSegmentViewsSchema>;
