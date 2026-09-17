import type { assetPoints } from "@bms/db";
import type { AdminAssetPointDto, QualityPolicy } from "@bms/shared";

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
};

/**
 * `F3.63` (ADR 0047 Amendment 6 §Q1 point 3) — the one projection from a
 * joined `asset_points` row to `AdminAssetPointDto`, shared by the admin list
 * (`AssetPointsAdminService`) and the non-admin read
 * (`AssetsService.listPoints`). A module-level function rather than a method,
 * so the non-admin module imports a pure mapper and not the admin service;
 * the parity case in `asset-points-read.integration.spec.ts` holds the two
 * reads to the same shape.
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
  };
}
