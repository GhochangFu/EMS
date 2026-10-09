import { z } from "zod";

import { assetIdsQueryField } from "../auth/asset-scope.schema";
import { DEFAULT_LATEST_WINDOW_MINUTES, MAX_LATEST_WINDOW_MINUTES } from "../telemetry/telemetry.schema";

/**
 * `GET /api/v1/assets/role-summary` (`F3.28`, ADR 0074, plan task 3.2 and
 * decision 1). One optional repeated `assetIds` parameter — the same field
 * `GET /alarms` and `GET /alarms/summary` take, folded by
 * `foldRepeatedQueryValue` and bounded at `MAX_SCOPE_ASSET_IDS`. It only ever
 * narrows the caller's readable set (`intersectReadable`), never widens it.
 *
 * `.strict()`: a misspelt `assetId=` would otherwise be dropped silently and
 * the caller handed the whole fleet's roles — an unknown key is a 400.
 */
export const assetRoleSummaryQuerySchema = z
  .object({
    assetIds: assetIdsQueryField,
  })
  .strict();

export type AssetRoleSummaryQuery = z.infer<typeof assetRoleSummaryQuerySchema>;

/**
 * `GET /api/v1/assets/:assetId/kpis` (`F2.33`, ADR 0097 decision 2 and "Ruled
 * here"). `windowMinutes` is the staleness budget: a KPI input older than it
 * at request time is stale. Default and bound are `GET /telemetry/points/latest`'s,
 * imported rather than restated, so the asset page has one meaning of
 * "current". `.strict()`: an unknown key is a 400, not a silent default.
 */
export const assetKpisQuerySchema = z
  .object({
    windowMinutes: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_LATEST_WINDOW_MINUTES)
      .default(DEFAULT_LATEST_WINDOW_MINUTES),
  })
  .strict();

export type AssetKpisQuery = z.infer<typeof assetKpisQuerySchema>;
