/**
 * Protocols an ingest adapter can serve.
 *
 * A protocol appears here only when an adapter could plausibly be written for
 * it; `modbus_rtu` and `dcs` are deliberately absent until `F1.6` needs them.
 * Adding one is a one-line change made by the adapter's own PR (ADR 0016 §7).
 *
 * A leaf module (`E7.2`), re-exported from `./ingest` unchanged, so that
 * `./ingest-uplink` can build its `protocol` enum from it without importing
 * `./ingest` back — the cycle would leave this array in its temporal dead zone
 * when the uplink schema is evaluated. `mqtt-topic.ts` is the same pattern.
 */
export const INGEST_PROTOCOLS = [
  "mqtt",
  "modbus_tcp",
  "bacnet",
  "opc_ua",
  "snmp",
  "rest_poller",
] as const;

export type IngestProtocol = (typeof INGEST_PROTOCOLS)[number];
