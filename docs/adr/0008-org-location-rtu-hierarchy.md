# ADR 0008 — Organization → Location → RTU → Asset → Point Key hierarchy

## Status

Accepted

## Context

ADR 0007 introduced PHE MQTT ingest with `bms.ingestion_gateways` bound to
`bms.locations`, modelling one RTU as one location. TeleCash source data and
operator mental models use:

`Organization → Station (location) → EdgeRTU → Device (asset) → DeviceSensor (point key)`

Eskom demo sites have no physical RTUs; telemetry is simulator-driven per
domain (electrical, HVAC, IT, environment).

## Decision

1. Add `bms.organizations` (`ESKOM`, `PHEWB`).
2. Bind `bms.locations.organization_id`; PHE locations represent `dbo.Station`
   (6 stations), not individual RTUs.
3. Add `bms.rtus` under locations; replace `bms.ingestion_gateways`.
4. Require `bms.assets.rtu_id`; keep `location_id` denormalized for access
   queries.
5. Eskom: one synthetic simulator RTU per domain per location.
6. PHE: one row per `dbo.EdgeRTU`; pilot MQTT ingest unchanged in scope.
7. Extend location dashboard API/UI with organization context and RTU grouping.

## Consequences

- PHE consolidates from 12 RTU-locations to 6 station locations + 12 RTUs.
- Asset UUIDs and `telemetry.point_values` history are preserved.
- Location dashboard bookmarks for old PHE RTU-location UUIDs break; use station
  slugs (`phe-bhutnirghat`, etc.).
- Org-level RBAC remains deferred; organization is display/catalog only.
