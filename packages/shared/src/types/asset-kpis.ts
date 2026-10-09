import type { z } from "zod";

import type * as K from "../contracts/asset-kpis";

/** `F2.33` (ADR 0097) — derived from the schemas, never written by hand (ADR 0030). */
export type AssetKpiState = z.infer<typeof K.assetKpiStateSchema>;

/** One KPI of `GET /api/v1/assets/:assetId/kpis`. */
export type AssetKpiValue = z.infer<typeof K.assetKpiValueSchema>;

/** `GET /api/v1/assets/:assetId/kpis`. */
export type AssetKpisResponse = z.infer<typeof K.assetKpisResponseSchema>;
