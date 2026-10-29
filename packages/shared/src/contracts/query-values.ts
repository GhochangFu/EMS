/**
 * `F4.290` (ADR 0099 Amendment 9 E4) — moved here byte for byte from
 * `apps/api/src/auth/asset-scope.schema.ts`, which re-exports it, so the
 * energy-report query in `report-writes.ts` folds `?locationIds=` with the one
 * rule every API query uses.
 */

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
