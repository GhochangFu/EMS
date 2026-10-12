/**
 * `F3.86` PR 1 — the RTU write bodies moved to `packages/shared/src/contracts/rtu-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  RTU_WILDCARD_TOPIC_MESSAGE,
  rtuSourceTypeSchema,
  createRtuBodySchema,
  updateRtuBodySchema,
  type CreateRtuBody,
  type UpdateRtuBody,
} from "@bms/shared";
