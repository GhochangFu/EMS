import { and, eq } from "drizzle-orm";

import { assetPoints, assets, locations, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AdminAssetPointDto, AssetPointPickerRow, QualityPolicy } from "@bms/shared";

/**
 * The joined row every asset-point read selects: the point, its asset's code
 * and name, and the asset's location (LEFT-joined, so nullable).
 */
export type AssetPointRow = {
  point: typeof assetPoints.$inferSelect;
  assetCode: string;
  assetName: string;
  locationId: string | null;
  locationName: string | null;
  /**
   * ADR 0056 Amendment 3 part A (`F2.25`) — the pinned template's point for
   * this key, LEFT-joined, so `null` = no template or the key is not declared.
   * `id` is never emitted. drizzle 0.38's `mapResultRow` nulls a left-joined
   * nested object when its **first** selected column is null, so `id` (never
   * null on a matched row) is selected first and must stay the first key —
   * otherwise a declared key with no `scaleMultiplier` reads as "no template".
   */
  template: {
    id: string;
    scaleMultiplier: number | null;
    scaleOffset: number | null;
    engMin: number | null;
    engMax: number | null;
    qualityPolicy: string | null;
  } | null;
};

/**
 * ADR 0056 Amendment 3 part A (`F2.25`) — the one select every asset-point
 * read starts from: the point, its asset, the asset's location, and the
 * **pinned** template's point for the same key (`assets.template_id`, not the
 * template's newest version — the rule `loadTemplatePointDefaults` applies).
 * `template_points_template_point_key_unique` (migration 0024) makes the
 * template join at most one row. Callers append `.where()` / `.orderBy()`.
 */
export function selectAssetPointRows(db: BmsDb) {
  return db
    .select({
      point: assetPoints,
      assetCode: assets.code,
      assetName: assets.name,
      locationId: assets.locationId,
      locationName: locations.name,
      template: {
        // First on purpose, and must stay first — see `AssetPointRow.template`.
        id: templatePoints.id,
        scaleMultiplier: templatePoints.scaleMultiplier,
        scaleOffset: templatePoints.scaleOffset,
        engMin: templatePoints.engMin,
        engMax: templatePoints.engMax,
        qualityPolicy: templatePoints.qualityPolicy,
      },
    })
    .from(assetPoints)
    .innerJoin(assets, eq(assetPoints.assetId, assets.id))
    .leftJoin(locations, eq(assets.locationId, locations.id))
    .leftJoin(
      templatePoints,
      and(eq(templatePoints.templateId, assets.templateId), eq(templatePoints.pointKey, assetPoints.pointKey)),
    );
}

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — the one projection from a
 * joined `asset_points` row to `AdminAssetPointDto`, shared by the admin list
 * (`AssetPointsAdminService`) and the non-admin read
 * (`AssetsService.listPoints`, which then narrows it with
 * {@link pickAssetPointPickerRow}). A module-level function rather than a
 * method, so the non-admin module imports a pure mapper and not the admin
 * service; the parity case in `asset-points-read.integration.spec.ts` holds
 * the two reads to the same values on the picked fields.
 */
export function mapAssetPointRow(row: AssetPointRow): AdminAssetPointDto {
  const point = row.point;
  return {
    id: point.id,
    assetId: point.assetId,
    assetCode: row.assetCode,
    assetName: row.assetName,
    locationId: row.locationId,
    locationName: row.locationName,
    pointKey: point.pointKey,
    sourceDataKey: point.sourceDataKey,
    sensorCode: point.sensorCode,
    unit: point.unit,
    active: point.active,
    // asset_points_source_kind_check guarantees this is one of the four
    // values; drizzle types the column as the column's raw varchar type.
    sourceKind: point.sourceKind as AdminAssetPointDto["sourceKind"],
    // ADR 0018 decision 3 / ADR 0056 Q-H — the wiring, so a client that just
    // set `rtuId` reads it back rather than inferring it from `sourceKind`.
    rtuId: point.rtuId,
    createdAt: point.createdAt.toISOString(),
    // `F2.7` / ADR 0056 decision 1 — the per-asset override of the five
    // metadata columns, `null` = inherit the template default. Read straight
    // off the row.
    scaleMultiplier: point.scaleMultiplier,
    scaleOffset: point.scaleOffset,
    engMin: point.engMin,
    engMax: point.engMax,
    qualityPolicy: point.qualityPolicy as QualityPolicy | null,
    // ADR 0056 Amendment 3 part A (`F2.25`) — the pinned template's five, as
    // declared; `null` = nothing to inherit. The effective value the ingest
    // host applies is `coalesce(asset, template)` per field; the web derives
    // it and the "inherited" marker from these two.
    templateDefaults: row.template
      ? {
          scaleMultiplier: row.template.scaleMultiplier,
          scaleOffset: row.template.scaleOffset,
          engMin: row.template.engMin,
          engMax: row.template.engMax,
          qualityPolicy: row.template.qualityPolicy as QualityPolicy | null,
        }
      : null,
  };
}

/**
 * The five-field `AssetPointPickerRow` (`F3.63` review) the non-admin read
 * returns, picked from the admin projection — so the two reads cannot compute
 * a field differently, and so the admin-only columns (ingest wiring, scaling,
 * plausibility, quality policy) never leave through `GET /assets/:id/points`.
 * Listed field by field rather than spread-and-delete: a key this function
 * does not name cannot reach the response.
 */
export function pickAssetPointPickerRow(dto: AdminAssetPointDto): AssetPointPickerRow {
  return {
    id: dto.id,
    assetId: dto.assetId,
    assetName: dto.assetName,
    pointKey: dto.pointKey,
    unit: dto.unit,
  };
}
