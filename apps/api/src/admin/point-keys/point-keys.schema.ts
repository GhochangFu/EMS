/**
 * `F3.86` PR 1 — the point-key write bodies moved to `packages/shared/src/contracts/point-key-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  createPointKeyBodySchema,
  updatePointKeyBodySchema,
  type CreatePointKeyBody,
  type UpdatePointKeyBody,
} from "@bms/shared";
