/**
 * The F1.9 import options and the 5 MiB file cap. `F4.283` (ADR 0099
 * Amendment 8, ADR 0030): they live in
 * `packages/shared/src/contracts/telemetry-import.ts`, so the copilot
 * catalog carries the route's own export by identity. Re-exported here under
 * their old names for the service, the onboarding and mapping-sheet readers
 * of the cap, and this file's spec; the controller imports them from
 * `@bms/shared`.
 */
export { MAX_IMPORT_FILE_BYTES, telemetryImportOptionsBodySchema } from "@bms/shared";
export type { TelemetryImportOptions } from "@bms/shared";
