/**
 * `PUT /api/v1/alarms/:id/enrichment` request body (ADR 0034 decision 6).
 *
 * `F4.284` (ADR 0106 decision 7, ADR 0030): the body lives in
 * `packages/shared/src/contracts/operations-writes.ts`, so the copilot catalog
 * entry `alarm.enrichment.set` carries the route's own export by identity, and
 * `apps/web/src/api/alarms.ts` types its payload from the same `z.infer`.
 * Re-exported here under its old name.
 */
export { alarmEnrichmentUpsertBodySchema } from "@bms/shared";
export type { AlarmEnrichmentUpsertBody } from "@bms/shared";
