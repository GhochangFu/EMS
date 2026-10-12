/**
 * `F3.86` PR 1 — the location write bodies moved to `packages/shared/src/contracts/location-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  locationTypeSchema,
  createLocationBodySchema,
  updateLocationBodySchema,
  type CreateLocationBody,
  type UpdateLocationBody,
} from "@bms/shared";
