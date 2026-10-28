import type { z } from "zod";

import type * as S from "../contracts/point-stats";

/** `F4.291` (ADR 0099 Amendment 9 E5(c)) — derived from the schemas, never written by hand (ADR 0030). */
export type PointStatsByAsset = z.infer<typeof S.pointStatsByAssetSchema>;

/** One asset's statistics in {@link PointStatsByAsset}. */
export type PointStatsRow = z.infer<typeof S.pointStatsRowSchema>;
