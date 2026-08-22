/**
 * The synthesised `source_data_key` a derived point's `asset_points` row
 * carries.
 *
 * `bms.asset_points.source_data_key` is `NOT NULL`, and a computed tag has no
 * honest source key — nothing on an RTU produces it. `CalcWriteService`
 * invented `computed:<pointKey>` for the row it creates on first value
 * (ADR 0037); ADR 0039 decision 7 adds a second creator, the override endpoint,
 * which creates the row eagerly rather than waiting for a value that the
 * override may be the very thing enabling.
 *
 * **Two creators must not drift on this format.** They write the same logical
 * row for the same `(asset_id, point_key)` pair, and
 * `asset_points_asset_id_point_key_unique` means whichever runs second finds
 * the first one's row. If the formats differed, the row's `source_data_key`
 * would depend on which creator happened to win the race — invisible until
 * something read it.
 *
 * Only the *format* is shared, deliberately. The two inserts stay separate:
 * `CalcWriteService` wants "create if missing, count creations" with its
 * SAVEPOINT isolation per pair, and the override path wants the row back so it
 * can update it.
 */

/**
 * `bms.asset_points.source_data_key` is `varchar(128)`.
 *
 * `pointKey` alone is Zod-validated up to 128 characters (`pointKeyCode` in
 * `asset-templates.schema.ts`) — the same limit, independently — so a
 * synthesised `"computed:" + pointKey` (9-character prefix) overflows once
 * `pointKey` exceeds 119 characters, even though `pointKey` on its own was
 * legal everywhere it was validated.
 */
export const SOURCE_DATA_KEY_MAX_LENGTH = 128;

/** The 9-character prefix. Named so the arithmetic above stays checkable. */
export const COMPUTED_SOURCE_DATA_KEY_PREFIX = "computed:";

export type ComputedSourceDataKeyResult =
  | { ok: true; sourceDataKey: string }
  | { ok: false; reason: "too_long"; length: number };

/**
 * Formats the key, or says it would not fit.
 *
 * Returns a result rather than throwing or truncating. Truncating would
 * silently collide two long point keys onto one `source_data_key`; throwing
 * would abort a caller that has other, perfectly good pairs to write — which
 * is precisely why `CalcWriteService` checks the length up front instead of
 * letting Postgres raise `22001` inside a SAVEPOINT it only guards against
 * `23505` for.
 */
export function computedSourceDataKey(pointKey: string): ComputedSourceDataKeyResult {
  const sourceDataKey = `${COMPUTED_SOURCE_DATA_KEY_PREFIX}${pointKey}`;
  if (sourceDataKey.length > SOURCE_DATA_KEY_MAX_LENGTH) {
    return { ok: false, reason: "too_long", length: sourceDataKey.length };
  }
  return { ok: true, sourceDataKey };
}
