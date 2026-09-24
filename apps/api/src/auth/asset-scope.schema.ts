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
 * Folds a repeated query parameter into an array (plan decision 1). Nest's
 * `@Query()` hands a bare string for one occurrence and an array for more
 * than one, so both shapes — and an absent parameter — become one before
 * {@link assetIdsQueryField}'s element and bound checks run.
 *
 * **Past 20 occurrences Express does not hand an array.** Its extended query
 * parser is `qs` with the default `arrayLimit: 20`, and a 21st repeat turns
 * the value into an index-keyed object (`{ "0": …, "1": …, … }`). The rail on
 * `/cr-overview` asks for its ~43 tracked assets, so without the fold an
 * admin's rail was a 400 (slice 1 security review). Only that exact overflow
 * shape — keys `0..n-1`, every one present, in order — folds; any other
 * object (`assetIds[a]=…`, a sparse `assetIds[30]=…`) reaches `z.array` as an
 * object and is refused.
 *
 * **This never widens a caller's scope.** It is only ever intersected with
 * the readable set through `intersectReadable` — the schema's job stops at
 * "is this well-formed", not "is this allowed".
 */
export function foldRepeatedQueryValue(value: unknown): unknown {
  if (value === undefined || Array.isArray(value)) {
    return value;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    const contiguous = keys.length > 0 && keys.every((key, index) => key === String(index));
    return contiguous ? keys.map((key) => (value as Record<string, unknown>)[key]) : value;
  }
  return [value];
}

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
