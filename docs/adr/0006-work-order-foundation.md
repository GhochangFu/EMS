# ADR 0006 — Work order foundation

## Status

Accepted for Phase 5 Sprint A.

## Context

Phase 2 real ingestion is paused on Path B until real source access is
available. The current pilot stack already has assets, alarms, telemetry,
audit logging, authentication, and observability. The next useful
operator workflow is a basic work order foundation that can link follow-up
work to existing assets and alarms.

## Decision

Add a lightweight work order domain in Phase 5 Sprint A:

- `bms.work_orders` for the operational record.
- `bms.work_order_tasks` for simple supporting task rows.
- Protected API endpoints to list, create, update status, and close work
  orders.
- Seed/demo work orders linked to existing assets and alarms.
- Audit rows for work order state changes.

The initial status lifecycle is `open`, `assigned`, `in_progress`,
`resolved`, and `closed`. The initial priority set is `low`, `medium`,
`high`, and `critical`.

## Consequences

- This sprint does not add maintenance schedules, rule-engine UI, reports,
  MinIO/object storage, real-ingestion adapters, or Phase 6 visuals.
- Work orders can be created from the API now and connected to Alarm
  Centre UI in a later sprint.
- The schema keeps links to assets and alarms nullable enough to support
  both asset-driven and alarm-driven work.
