/**
 * `F2.7` / ADR 0056 decisions 2 and 3 — the **write** side of the five point
 * metadata fields.
 *
 * The definitions moved to `packages/shared/src/contracts/point-metadata-writes.ts`
 * in `F3.85` PR 11a (plan §11.3 Unit 1), because the template point body that
 * spreads `pointMetadataBodyShape` moved to `packages/shared` so the copilot
 * catalog can name it by identity. This file re-exports them, so
 * the asset-point service, the mapping-sheet plan and
 * the template migration keep their imports unchanged.
 */
export {
  findEmptyEngineeringRange,
  hasAnyPointMetadata,
  NO_POINT_METADATA,
  pointMetadataBodyShape,
  refinePointMetadata,
  validateMergedPointMetadata,
  type EmptyEngineeringRange,
  type PointMetadataBody,
} from "@bms/shared";
