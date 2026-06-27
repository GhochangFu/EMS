# ADR 0007 — PHE MQTT ingest pilot (Phase 2 Path A)

## Status

Accepted

## Context

Path B (simulator-only) is active for the Eskom SMOC demo stack, but a real
MQTT source exists for West Bengal Public Health Engineering (PHEWB) pump
houses via ThinkIoT (`phe.thinkiot.co.in`). Catalog data (RTU, device,
sensor, `DataKey` mapping) lives in `TeleCash_Wallet_1` on Azure SQL.

## Decision

1. Add `bms.ingestion_gateways` and `bms.asset_points` for catalog + MQTT
   topic binding.
2. Seed PHEWB OrgId 10 catalog into Postgres from exported MSSQL snapshot
   (`packages/db/src/phe-catalog.json`).
3. Add `apps/ingest` — MQTT TLS subscriber that writes
   `telemetry.point_values` and `pg_notify('bms_telemetry', …)` using the
   same pipeline as `apps/sim`.
4. Enable live ingest for **one pilot RTU** only (Bhutnirghat I,
   `EdgeRTUId = 13`, topic `Airsprint-1051/Data/861736076104923`).
5. Skip simulator output for assets with `meta.telemetrySource = 'mqtt'`.

## Dependencies

- `mqtt` (MQTT.js v5) in `apps/ingest` only.

## Consequences

- Phase 2 Path A is partially promoted for the PHE pilot scope only.
- EMQX and multi-protocol adapters remain deferred.
- Credentials are env-only (`MQTT_*`), never committed.
