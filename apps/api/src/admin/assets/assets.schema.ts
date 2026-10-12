/**
 * `F3.86` PR 1 — the asset write bodies moved to `packages/shared/src/contracts/asset-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  optionalText,
  createAssetBodySchema,
  updateAssetBodySchema,
  type CreateAssetBody,
  type UpdateAssetBody,
} from "@bms/shared";
