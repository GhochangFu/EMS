import { z } from "zod";

import { foldRepeatedQueryValue } from "@bms/shared";

/**
 * `F3.28` (ADR 0074, plan decision 1) — a caller's requested asset scope on a
 * query, shared by every route that lets a caller narrow the alarms rail or a
 * per-role read to a subset of what they can already see.
 *
 * `MAX_SCOPE_ASSET_IDS` mirrors `migrateAssetsBodySchema`'s ceiling — one
 * batch, the same shape of bound for the same reason: a caller cannot name
 * more assets in a single request than a reasonable page of the fleet holds.
 */
export const MAX_SCOPE_ASSET_IDS = 200;

/** `F4.290`: the fold moved to `@bms/shared` (the energy-report query uses it); re-exported so its importers stay unchanged. */
export { foldRepeatedQueryValue } from "@bms/shared";

/**
 * `?assetIds=a&assetIds=b` as a repeated query parameter, normalised to an
 * array of at most {@link MAX_SCOPE_ASSET_IDS} uuids (plan decision 1). The
 * fold is {@link foldRepeatedQueryValue}; the result only ever narrows a
 * caller's readable set, never widens it.
 */
export const assetIdsQueryField = z
  .preprocess(foldRepeatedQueryValue, z.array(z.string().uuid()).max(MAX_SCOPE_ASSET_IDS))
  .optional();

export type AssetIdsQueryField = z.infer<typeof assetIdsQueryField>;
