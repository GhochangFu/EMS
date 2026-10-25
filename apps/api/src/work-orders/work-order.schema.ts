/**
 * `F4.284` (ADR 0106 decision 7, ADR 0030): the work-order write bodies live in
 * `packages/shared/src/contracts/operations-writes.ts`, so the copilot catalog
 * entries carry the route's own exports by identity; the status and priority
 * vocabularies are the shared ones in `contracts/operations.ts` (this file used
 * to declare a second copy). Re-exported here under their old names.
 */
export {
  closeWorkOrderBodySchema,
  createWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
  workOrderPrioritySchema,
  workOrderStatusSchema,
} from "@bms/shared";
export type {
  CloseWorkOrderBody,
  CreateWorkOrderBody,
  ReorderWorkOrdersBody,
  UpdateWorkOrderStatusBody,
} from "@bms/shared";
