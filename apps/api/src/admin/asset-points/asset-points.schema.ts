/**
 * `F3.86` PR 1 — the asset-point write bodies moved to `packages/shared/src/contracts/asset-point-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  createAssetPointBodySchema,
  updateAssetPointBodySchema,
  assetPointBulkPatchSchema,
  assetPointBulkUpdateBodySchema,
  mappingSheetQuerySchema,
  type CreateAssetPointBody,
  type UpdateAssetPointBody,
  type AssetPointBulkPatch,
  type AssetPointBulkUpdateBody,
  type MappingSheetQuery,
} from "@bms/shared";
