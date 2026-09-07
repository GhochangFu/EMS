import { eq } from "drizzle-orm";

import { assets, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  CONTROL_ROOM_ELECTRICAL_POINT_KEYS,
  CONTROL_ROOM_ENVIRONMENT_POINT_KEYS,
  CONTROL_ROOM_IT_POINT_KEYS,
  CONTROL_ROOM_UPS_POINT_KEYS,
  ELECTRICAL_POINT_KEYS,
  HVAC_POINT_KEYS,
} from "@bms/shared";

/**
 * Which telemetry points a rule may reference for a given asset.
 *
 * Used twice: to populate the guided builder's catalog, and to reject a draft
 * whose point does not belong to its asset. Both must agree, which is why it is
 * one function rather than two lists.
 *
 * Order matters — the `CR-` prefix checks are narrower than the trailing
 * control-room electrical fallback, so they have to come first.
 */
export function pointKeysForAsset(domain: string, code: string): string[] {
  if (code.startsWith("CR-RACK") || code.startsWith("CR-PDU")) {
    return [...CONTROL_ROOM_IT_POINT_KEYS];
  }
  if (code.startsWith("CR-UPS") || code.startsWith("CR-BATT")) {
    return [...CONTROL_ROOM_UPS_POINT_KEYS];
  }
  if (domain === "environment" || code.startsWith("CR-ENV") || code.startsWith("CR-LEAK") || code.startsWith("CR-SMOKE")) {
    return [...CONTROL_ROOM_ENVIRONMENT_POINT_KEYS];
  }
  if (domain === "hvac") {
    return [...HVAC_POINT_KEYS];
  }
  if (code.startsWith("CR-")) {
    return [...CONTROL_ROOM_ELECTRICAL_POINT_KEYS];
  }
  return [...ELECTRICAL_POINT_KEYS];
}

/**
 * The point keys the **pinned template** of an asset declares — `E2.4` Q1.
 *
 * `pointKeysForAsset` above is a hard-coded map written when every asset was a
 * control-room one, and it falls through to `ELECTRICAL_POINT_KEYS` for every
 * domain it does not name. Since ADR 0015 an asset can instead be instantiated
 * from a template, and `assets.template_id` pins the exact version it was built
 * from, so `template_points` is an authoritative second answer to the same
 * question — one that covers the water, mechanical and facility packs the map
 * never learnt about.
 *
 * Without this, ADR 0058's promise is unreachable for those assets: a seeded
 * rule's `point_key` comes from the template, so the commissioning PATCH that
 * arms a philosophy row, and any later local override of a seeded threshold,
 * would both be refused by `assertCompatiblePoint` on a point the asset
 * demonstrably has.
 *
 * **No `kind` filter, deliberately.** A `derived` template point has no
 * `asset_points` row — `F2.2` cannot emit one, because `source_data_key` is NOT
 * NULL and a computed tag has no honest source key — and it is still a legal
 * rule target: the calc engine writes its samples. That is the whole reason the
 * `E2.4` Q1 ruling widened this check with `template_points` rather than with
 * `asset_points`, which would have refused every derived point.
 *
 * An `innerJoin` and no null guard on purpose: a hand-created asset has
 * `template_id = NULL` and joins to zero rows, which is the honest answer —
 * it declares no template points, so the hard-coded map remains its only source.
 *
 * `fleetDb`, because `template_points` is a tenant table under `FORCE ROW LEVEL
 * SECURITY` and a bare tenant handle reads zero rows from it outside a
 * `withTenant` block — which would silently refuse every point rather than
 * widen the check. This is a pre-write lookup on a path where the caller has
 * already scope-checked the asset, so the isolation control is that check and
 * the `assetId` in the WHERE, not the pool.
 *
 * Called only when the hard-coded lookup misses, so no existing rule edit pays
 * for it and none of them changes behaviour.
 */
export async function templatePointKeysForAsset(
  fleetDb: BmsDb,
  assetId: string,
): Promise<string[]> {
  const rows = await fleetDb
    .select({ pointKey: templatePoints.pointKey })
    .from(templatePoints)
    .innerJoin(assets, eq(assets.templateId, templatePoints.templateId))
    .where(eq(assets.id, assetId));
  return rows.map((row) => row.pointKey);
}
