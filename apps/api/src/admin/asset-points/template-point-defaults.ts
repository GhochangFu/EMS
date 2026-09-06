import { and, eq, inArray } from "drizzle-orm";

import { assets, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { PointMetadataFields, QualityPolicy } from "@bms/shared";

/**
 * `F2.7` / ADR 0056 decision 1 — the class defaults an asset point inherits.
 *
 * The resolved value of each of the five is
 * `coalesce(asset_points.col, template_points.col)`, joined through
 * `assets.template_id` and `point_key` (ADR 0039 decisions 6/7's pattern, which
 * the ingest host's `BINDING_QUERY` performs in SQL). The API needs the same
 * defaults for a different reason: the merged-pair refusal has to *name* the
 * inherited bound, and a refusal that says "eng_min must be below eng_max" to
 * an author who never typed an eng_max is not actionable.
 *
 * A separate module from the service because four callers need it — the create
 * and update routes here, the mapping sheet's row planner and the bulk editor —
 * and because a query is the one part of the rule that cannot be unit-tested
 * without a database.
 */

/** One template point's contribution: what it is, what it defaults, what it measures in. */
export type TemplatePointDefault = {
  /** `measured` or `derived`, as the pinned version declares it. */
  readonly kind: string;
  /** The five, `null` per column meaning "the template sets no default either". */
  readonly defaults: PointMetadataFields;
  /** The template's own unit, which the instantiation rule prefers over the catalog's. */
  readonly unit: string | null;
};

/**
 * The pinned template's declaration of each of `pointKeys`, for one asset.
 *
 * Read on whatever connection the caller passes: `fleetDb` behind an
 * already-computed `canManageAsset` grant (Amendment 2/3, the shape every read
 * in `asset-points.service.ts` uses), or a tenant transaction where one is
 * already open.
 *
 * An asset with **no** template, or one whose template does not declare the
 * key, yields no entry — never a row of nulls. The caller reads a missing entry
 * as "nothing to inherit", which is exactly what a hand-created asset has.
 */
export async function loadTemplatePointDefaults(
  db: BmsDb,
  assetId: string,
  pointKeys: readonly string[],
): Promise<Map<string, TemplatePointDefault>> {
  const byAsset = await loadTemplatePointDefaultsForAssets(db, [assetId], pointKeys);
  return byAsset.get(assetId) ?? new Map();
}

/**
 * The same defaults for **many** assets at once, keyed by `assets.id`.
 *
 * The bulk editor (ADR 0056 decision 8) validates every selected row against
 * its own template before it writes anything, and a selection may span up to
 * `MAX_ASSET_POINT_BULK_IDS` rows on as many assets. Asking per asset would be
 * one round trip per row inside a request that must decide all-or-nothing
 * before it opens a transaction.
 *
 * An asset with no template, or one whose template declares none of the wanted
 * keys, has **no entry** — the same reading as the single-asset form: a missing
 * entry is "nothing to inherit", never a row of nulls.
 */
export async function loadTemplatePointDefaultsForAssets(
  db: BmsDb,
  assetIds: readonly string[],
  pointKeys: readonly string[],
): Promise<Map<string, Map<string, TemplatePointDefault>>> {
  const wanted = [...new Set(pointKeys)];
  const wantedAssets = [...new Set(assetIds)];
  // Both guards, and neither is decorative: `inArray` with an empty list is a
  // SQL `in ()` — a syntax error on Postgres rather than an empty result.
  if (wanted.length === 0 || wantedAssets.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      assetId: assets.id,
      pointKey: templatePoints.pointKey,
      kind: templatePoints.kind,
      unit: templatePoints.unit,
      scaleMultiplier: templatePoints.scaleMultiplier,
      scaleOffset: templatePoints.scaleOffset,
      engMin: templatePoints.engMin,
      engMax: templatePoints.engMax,
      qualityPolicy: templatePoints.qualityPolicy,
    })
    .from(templatePoints)
    // The join is the asset's *pinned* version — `assets.template_id` points at
    // one `asset_templates` row, and a version bump re-points it. Reading the
    // code's newest version instead would resolve defaults the asset does not
    // have yet, which is the whole subject of the migration surface.
    .innerJoin(assets, eq(assets.templateId, templatePoints.templateId))
    .where(and(inArray(assets.id, wantedAssets), inArray(templatePoints.pointKey, wanted)));

  const byAsset = new Map<string, Map<string, TemplatePointDefault>>();
  for (const row of rows) {
    let forAsset = byAsset.get(row.assetId);
    if (!forAsset) {
      forAsset = new Map<string, TemplatePointDefault>();
      byAsset.set(row.assetId, forAsset);
    }
    forAsset.set(row.pointKey, {
      kind: row.kind,
      unit: row.unit,
      defaults: {
        scaleMultiplier: row.scaleMultiplier,
        scaleOffset: row.scaleOffset,
        engMin: row.engMin,
        engMax: row.engMax,
        // `template_points_quality_policy_check` guarantees the vocabulary;
        // drizzle types the column as its raw varchar, the same narrowing
        // `toTemplatePointDto` makes on the way out to a DTO.
        qualityPolicy: row.qualityPolicy as QualityPolicy | null,
      },
    });
  }
  return byAsset;
}
