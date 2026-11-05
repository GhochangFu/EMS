import { ConflictException } from "@nestjs/common";

import { constraintOf } from "../../database/translate-constraint-errors";

/**
 * `F4.216`/`F4.222` — turns a unique violation on the migration's `asset_points`
 * insert into a 409 with a sentence. `buildPlan` refuses a source key an
 * existing row holds, and two new points of one asset resolving to one key, but
 * it reads before the write transaction opens, so a row inserted in between
 * still reaches the index. The source key and the point key each get their own
 * sentence (the operator must not be told the wrong key); any other constraint
 * is returned unchanged for `translateConstraintErrors` to rethrow raw.
 *
 * `F4.312` — `operation` names the act in the sentence's first word; omitted it
 * is `"migration"`, so migrate's text is unchanged byte for byte.
 */
export function translateAssetPointInsertUnique(
  err: unknown,
  operation: "migration" | "adoption" = "migration",
): Error {
  switch (constraintOf(err)) {
    case "asset_points_asset_source_key_idx":
      return new ConflictException(
        `This ${operation} is refused. Nothing was written. A new point's source ` +
          "key is already used on the same asset by a point added since the " +
          "plan was read (one source key maps to one point per asset). Check " +
          "the asset's points, then try again.",
      );
    case "asset_points_asset_id_point_key_unique":
      return new ConflictException(
        `This ${operation} is refused. Nothing was written. A new point's point ` +
          "key is already used on the same asset by a point added since the " +
          "plan was read (a point key appears once per asset). Check the " +
          "asset's points, then try again.",
      );
    default:
      return err as Error;
  }
}
