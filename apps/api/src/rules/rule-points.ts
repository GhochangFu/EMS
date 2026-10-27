import { BadRequestException } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetPoints, assets, templatePoints } from "@bms/db";
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
 * one function rather than two lists — and since `F3.49` both reach it only
 * through `ruleTargetPointKeysByAsset` below, which unions it with the asset's
 * pinned-template keys.
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
 * Map order first, then template-only keys in template order, then the asset's
 * own mapped keys in the order given; a key in more than one source appears
 * once, at its first — ADR 0058 Amendment 2, properties 2 and 3, and
 * Amendment 4 decision 4 (`F4.287`).
 *
 * Map first so an asset with no template and no mapped point keeps its list
 * byte-for-byte, and so every assertion on `pointKeysForAsset` above holds
 * through this. Neither later source needs a dedupe of its own:
 * `(template_id, point_key)` and `(asset_id, point_key)` are both unique.
 */
export function mergeRulePointKeys(
  domain: string,
  code: string,
  templateKeys: readonly string[],
  assetPointKeys: readonly string[],
): string[] {
  const merged = pointKeysForAsset(domain, code);
  const seen = new Set(merged);
  for (const key of [...templateKeys, ...assetPointKeys]) {
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(key);
    }
  }
  return merged;
}

/**
 * The point keys a rule may target, per asset id — the hard-coded map ∪ the
 * pinned template's keys ∪ the asset's active `asset_points` keys. Every input
 * asset gets an entry.
 *
 * `F3.49` / ADR 0058 Amendment 2: the **one** place the union is computed.
 * `assertCompatiblePoint` below refuses a draft against it and
 * `RulesService.getBuilderCatalog` offers it, so picker == validator is
 * structural rather than asserted —
 * `tests/f3.49-picker-validator-single-source.test.ts` holds that this file
 * has one reader of the map, one of `template_points` and one of
 * `asset_points`.
 *
 * Why the template side exists at all (`E2.4` Q1): `pointKeysForAsset` is a
 * hard-coded map written when every asset was a control-room one, and it falls
 * through to `ELECTRICAL_POINT_KEYS` for every domain it does not name. Since
 * ADR 0015 an asset can instead be instantiated from a template, and
 * `assets.template_id` pins the exact version it was built from, so
 * `template_points` is an authoritative second answer to the same question —
 * one that covers the water, mechanical and facility packs the map never
 * learnt about. Without it, ADR 0058's promise is unreachable for those
 * assets: a seeded rule's `point_key` comes from the template, so the
 * commissioning PATCH that arms a philosophy row, and any later local override
 * of a seeded threshold, would both be refused by `assertCompatiblePoint` on a
 * point the asset demonstrably has.
 *
 * **No `kind` filter, deliberately.** A `derived` template point has no
 * `asset_points` row — `F2.2` cannot emit one, because `source_data_key` is NOT
 * NULL and a computed tag has no honest source key — and it is still a legal
 * rule target: the calc engine writes its samples. That is the whole reason the
 * `E2.4` Q1 ruling widened this check with `template_points` rather than with
 * `asset_points`, which would have refused every derived point.
 *
 * **Why the `asset_points` side exists** (`F4.287`, ADR 0058 Amendment 4): a
 * hand-created or ingest-seeded asset has no template, so before it the map was
 * its only source — and a PHE gateway (`environment`, no template) could hold
 * no rule on the `battery_charge_pct` it reports live. A union, not a
 * replacement, so the derived points above stay offered. Active rows only: a
 * deactivated mapping receives no samples, and a rule on it could never fire.
 *
 * An `innerJoin` and no null guard on purpose: a hand-created asset has
 * `template_id = NULL` and joins to zero rows, which is the honest answer —
 * it declares no template points, so the hard-coded map remains its only source.
 *
 * `fleetDb`, because `template_points` is a tenant table under `FORCE ROW LEVEL
 * SECURITY` and a bare tenant handle reads zero rows from it outside a
 * `withTenant` block — which would silently refuse every point rather than
 * widen the check.
 *
 * **Two callers now, two shapes of the same containment, and the pool is
 * neither of them** (§4.3). This paragraph served only the validator before
 * `F3.49`, and saying "the `assetId` in the WHERE" would now describe half of
 * its callers. `assertCompatiblePoint` passes one asset it has already
 * scope-checked, so the control is that check plus the single id.
 * `getBuilderCatalog` passes the rows its own asset query returned — filtered
 * by the caller's `readableAssetIds`, or every asset when that is `null`, which
 * is the unrestricted admin — so the control is that filter plus an `inArray`
 * over exactly those ids. No caller-supplied id reaches this WHERE on either
 * path.
 *
 * That `inArray` makes the catalog's unfiltered branch bind one parameter per
 * fleet asset, against Postgres's 65535-per-message ceiling. The ceiling is
 * named here rather than chunked away: that branch already returns every asset
 * with no pagination, so the route has been linear in fleet size since long
 * before this function, and bounding it is the route's question rather than
 * this query's.
 *
 * Runs on every validation, not only when the map misses — Amendment 2
 * property 1. A map-first short-circuit is a second code path, and the catalog
 * cannot be lazy at all.
 *
 * The cost lands in two places rather than one, because this function has two
 * callers. Through `assertCompatiblePoint` it is two extra indexed queries per
 * rule validation (`asset_points` reads on its `(asset_id, point_key)` unique
 * index) — a human-paced, role-gated write path, and the evaluation
 * sweep and `AlarmEngineService` reach it on neither. Through
 * `getBuilderCatalog` it is two queries per catalog read, of whatever size that
 * read already was.
 *
 * Ordered by `(sort_order, point_key)`. `sort_order` is the author's declared
 * order; the `point_key` tie-break exists because the health seed writes
 * `sort_order = 0` on every row it creates, and without it those keys arrive
 * in heap order, which differs between databases. The `asset_points` read is
 * ordered by `point_key` for the same reason.
 */
export async function ruleTargetPointKeysByAsset(
  fleetDb: BmsDb,
  assetRows: ReadonlyArray<{ id: string; code: string; domain: string }>,
): Promise<Map<string, string[]>> {
  // A saved round-trip, not a crash guard: drizzle-orm 0.38.4 renders
  // `inArray(col, [])` as sql`false`, so without this the query below still
  // runs and answers nothing. Do not remove it as "defensive".
  if (assetRows.length === 0) {
    return new Map();
  }
  const assetIds = assetRows.map((row) => row.id);
  const [rows, mappedRows] = await Promise.all([
    fleetDb
      .select({ assetId: assets.id, pointKey: templatePoints.pointKey })
      .from(templatePoints)
      .innerJoin(assets, eq(assets.templateId, templatePoints.templateId))
      .where(inArray(assets.id, assetIds))
      .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey)),
    fleetDb
      .select({ assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
      .from(assetPoints)
      .where(and(inArray(assetPoints.assetId, assetIds), eq(assetPoints.active, true)))
      .orderBy(asc(assetPoints.pointKey)),
  ]);

  // Seeded from the input, so an asset that joins to zero rows still has an
  // entry; a row for an asset not asked about is ignored, not answered.
  const templateKeys = new Map<string, string[]>(assetRows.map((row) => [row.id, []]));
  for (const row of rows) {
    templateKeys.get(row.assetId)?.push(row.pointKey);
  }
  const mappedKeys = new Map<string, string[]>(assetRows.map((row) => [row.id, []]));
  for (const row of mappedRows) {
    mappedKeys.get(row.assetId)?.push(row.pointKey);
  }
  return new Map(
    assetRows.map((row) => [
      row.id,
      mergeRulePointKeys(row.domain, row.code, templateKeys.get(row.id) ?? [], mappedKeys.get(row.id) ?? []),
    ]),
  );
}

/**
 * Refuses a threshold draft whose point its asset cannot target — the same
 * set `ruleTargetPointKeysByAsset` gives the picker, by construction.
 */
export async function assertCompatiblePoint(
  fleetDb: BmsDb,
  assetId: string,
  pointKey: string,
): Promise<void> {
  // fleetDb: a pre-write asset lookup, already scope-checked by the caller.
  const [asset] = await fleetDb
    .select({ code: assets.code, domain: assets.domain })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) {
    throw new BadRequestException("Selected asset does not exist");
  }
  const accepted =
    (await ruleTargetPointKeysByAsset(fleetDb, [{ id: assetId, ...asset }])).get(assetId) ?? [];
  if (!accepted.includes(pointKey)) {
    throw new BadRequestException("Selected telemetry point is not compatible with asset");
  }
}
