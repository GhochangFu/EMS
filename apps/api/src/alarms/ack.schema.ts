/**
 * `F4.284` (ADR 0106 decision 7, ADR 0030): the ack body lives in
 * `packages/shared/src/contracts/operations-writes.ts`, so the copilot catalog
 * entry `alarm.acknowledge` carries the route's own export by identity.
 * Re-exported here under its old name.
 */
export { alarmAckBodySchema } from "@bms/shared";
export type { AlarmAckBody } from "@bms/shared";
