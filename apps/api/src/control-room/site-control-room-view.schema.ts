/**
 * `F3.86` PR 1 — the site Control Room view write body moved to `packages/shared/src/contracts/site-control-room-view-writes.ts`. This file re-exports them (the `F3.85` PR 11a
 * pattern), so every controller, service and spec keeps its import unchanged.
 */
export {
  putSiteControlRoomViewBodySchema,
  type PutSiteControlRoomViewBody,
} from "@bms/shared";
