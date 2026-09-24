import { z } from "zod";

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

/**
 * `?assetIds=a&assetIds=b` as a repeated query parameter, normalised to an
 * array (plan decision 1). Nest's `@Query()` hands a bare string for one
 * occurrence and an array for more than one, so the preprocess step folds
 * both shapes — and an absent parameter — into one before the element and
 * bound checks run.
 *
 * **This never widens a caller's scope.** It is only ever intersected with
 * the readable set through `intersectReadable` — the schema's job stops at
 * "is this well-formed", not "is this allowed".
 */
export const assetIdsQueryField = z
  .preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(z.string().uuid()).max(MAX_SCOPE_ASSET_IDS),
  )
  .optional();

export type AssetIdsQueryField = z.infer<typeof assetIdsQueryField>;
