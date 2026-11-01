/**
 * `F4.301` / ADR 0108 Amendment 2 — the trend strip query and response types,
 * each `z.infer`red from its schema in `../contracts/trend-strip` (ADR 0030
 * decision 2). Re-exported by `index.ts` (§4.8: that file is at the cap).
 */
import type { z } from "zod";

import type * as TS from "../contracts/trend-strip";

export type TrendStripRange = z.infer<typeof TS.trendStripRangeSchema>;
export type SiteTrendStripQuery = z.infer<typeof TS.siteTrendStripQuerySchema>;
export type TrendStripAssetSeriesDto = z.infer<typeof TS.trendStripAssetSeriesSchema>;
export type TrendStripPointDto = z.infer<typeof TS.trendStripPointSchema>;
export type TrendStripSegmentDto = z.infer<typeof TS.trendStripSegmentSchema>;
export type SiteTrendStripDto = z.infer<typeof TS.siteTrendStripSchema>;

import type * as TSW from "../contracts/trend-strip-widget";

/** `F4.305` — the `trend_strip` widget's stored config. */
export type TrendStripWidgetConfig = z.infer<typeof TSW.trendStripWidgetConfigSchema>;
