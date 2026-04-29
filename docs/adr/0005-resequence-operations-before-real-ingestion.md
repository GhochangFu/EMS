# ADR 0005 — Proposed resequencing if real ingestion access remains unavailable

## Status

Proposed

## Context

Phase 2 real ingestion is intended to replace the simulator with real
device/protocol data via adapters and brokered ingestion. Phase 2 Sprint 0
exists to confirm whether real protocol/device access, credentials,
network route, and sample payload/register/object lists are available.

If Sprint 0 confirms that no reachable source is available, continuing
with real ingestion implementation would create speculative adapters and
infrastructure that cannot be validated. The current simulator, alarms,
assets, telemetry, Energy Centre, and Phase 1 pilot stack are stable
enough to support operational workflow features.

## Proposed Decision

If Phase 2 Sprint 0 selects **Path B**, pause Phase 2 implementation until
real access exists. Move next to **Phase 5 operations modules**, starting
with work order foundation, then work order UI, maintenance tasks, basic
rules, energy reports, and optional report storage.

Phase 6 remains planned after Phase 5 but is narrowed to **Three.js Control
Room 3D only**. AI Copilot / chatbot is deferred and remains out of scope.

## Consequences

- Real protocol adapters, EMQX, MQTT subscriber work, and brokered
  ingestion remain out of scope until a future Phase 2 implementation
  sprint promotes one confirmed source/protocol.
- Phase 5 can deliver useful operator workflows using existing simulated
  alarms, assets, and telemetry.
- MinIO/object storage is deferred until generated report persistence is
  required.
- Phase 6 work must not introduce AI/chatbot dependencies or data access
  patterns.
