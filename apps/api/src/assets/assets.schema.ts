import { z } from "zod";

import { assetIdsQueryField } from "../auth/asset-scope.schema";

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
