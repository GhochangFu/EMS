import type { PointMetadataFields, PointSourceKind, TemplatePointKind } from "@bms/shared";

/**
 * The read-side picture of one location the mapping sheet works from (`F2.7`,
 * ADR 0056 decisions 6 and 7) — the rows `MappingSheetService` loads inside
 * `withTenant` and hands to the two pure modules: `mapping-sheet-export.ts`
 * builds the workbook from it, `mapping-sheet-plan.ts` diffs a parsed sheet
 * against it. Declared here, apart from both, so the service builds one
 * snapshot for export and one for preview/commit from the same row mappers, and
 * so the identity property (export → import = no change) is a test over one
 * value rather than over two hand-kept shapes.
 *
 * Pure types and two key builders; no IO, no zod.
 */

/** One `bms.assets` row of the location, keyed by its `code` in the snapshot. */
export type SnapshotAsset = {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  /** The pinned template version, or `null` for an asset with no template. */
  readonly templateId: string | null;
  /** The asset's own RTU — what a pre-fill row's `rtu_code` names. */
  readonly rtuId: string | null;
};

/** One `bms.asset_points` row, every column the sheet reads or writes. */
export type ExistingRow = {
  readonly id: string;
  readonly assetId: string;
  readonly pointKey: string;
  readonly sourceKind: PointSourceKind;
  readonly rtuId: string | null;
  readonly sourceDataKey: string;
  readonly unit: string | null;
  readonly active: boolean;
  /** The stored override — `null` per field means "inherit the template". */
  readonly metadata: PointMetadataFields;
};

/** One `bms.template_points` row of a pinned version — the pre-fill source and the metadata default. */
export type SnapshotTemplatePoint = {
  readonly templateId: string;
  readonly pointKey: string;
  readonly kind: TemplatePointKind;
  readonly unit: string | null;
  /** `{token}` grammar per `source-key-pattern.ts`; `null` when the point has none. */
  readonly sourceDataKeyPattern: string | null;
  /** The class default the asset's `null` columns inherit. */
  readonly defaults: PointMetadataFields;
};

/** One `bms.point_keys` row — the catalog unit a create falls back to, and whether the key is live. */
export type SnapshotCatalogEntry = {
  readonly unit: string | null;
  readonly active: boolean;
};

/**
 * What the export needs: the location's assets by code, its non-computed
 * `asset_points` rows by `(assetId, pointKey)`, every RTU's code by id (active
 * or not — an existing row wired to a retired RTU still names it), the catalog
 * and the pinned template points by `(templateId, pointKey)`.
 */
export type ExportSnapshot = {
  readonly assetsByCode: ReadonlyMap<string, SnapshotAsset>;
  readonly existingByAssetPoint: ReadonlyMap<string, ExistingRow>;
  readonly rtuCodesById: ReadonlyMap<string, string>;
  readonly catalog: ReadonlyMap<string, SnapshotCatalogEntry>;
  readonly templatePoints: ReadonlyMap<string, SnapshotTemplatePoint>;
};

/**
 * What the planner needs on top of the export's picture: the **active** RTUs
 * by code (step 9 resolves `rtu_code` against these) and every existing row's
 * `pointKey` by `(assetId, sourceDataKey)` (step 14's check against the
 * location's stored keys). A `PlanSnapshot` is an `ExportSnapshot`, so one
 * value serves both — which is what `assertExportedRowsPlanAsIdentity` relies on.
 */
export type PlanSnapshot = ExportSnapshot & {
  readonly rtusByCode: ReadonlyMap<string, string>;
  readonly existingByAssetSource: ReadonlyMap<string, string>;
};

/** The `existingByAssetPoint` / `templatePoints` map key: `"<ownerId>|<pointKey>"`. */
export function assetPointKey(ownerId: string, pointKey: string): string {
  return `${ownerId}|${pointKey}`;
}

/** The `existingByAssetSource` map key: `"<assetId>|<sourceDataKey>"`. */
export function assetSourceKey(assetId: string, sourceDataKey: string): string {
  return `${assetId}|${sourceDataKey}`;
}
