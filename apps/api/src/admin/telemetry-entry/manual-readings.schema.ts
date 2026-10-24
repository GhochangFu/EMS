/**
 * The F1.8/F1.9 manual-entry request body. `F4.283` (ADR 0099 Amendment 8,
 * ADR 0030): it lives in `packages/shared/src/contracts/telemetry-entry.ts`,
 * so the copilot catalog carries the route's own export by identity.
 * Re-exported here under its old name for the OpenAPI registry, the
 * strict-body ledger and this file's spec; the controller imports it from
 * `@bms/shared`.
 */
export { manualReadingsBodySchema } from "@bms/shared";
