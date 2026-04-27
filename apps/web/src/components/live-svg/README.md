# Live SVG components

## `SchematicTelemetryProvider`

Wraps a schematic screen (SLD, CRAC loop) and:

- Loads `GET /api/v1/assets` to map **asset codes** → UUIDs.
- Hydrates recent points per `pointKeys` (defaults to `ELECTRICAL_POINT_KEYS` from `@bms/shared`).
- Subscribes once to Socket.IO `/ws/telemetry` and merges readings for those UUIDs.

For the electrical SLD, pass only `assetCodes` (see `sld-bindings.ts`). For CRAC, pass `assetCodes` from `crac-bindings.ts` and `pointKeys={[...HVAC_POINT_KEYS]}`.

## `LiveSvgComponent`

Optional wrapper: `children` is a render prop receiving `{ status, kw, stale }` derived from `useSchematicTelemetry(assetId)`. Use when a small SVG subtree should react to one asset without inlining hooks.

Decorative nodes (no telemetry) omit `assetId`; children get `running` and `kw: null`.

## `ElectricalSldDiagram`

Sprint 6 single-line view aligned with `ESKOM_SMOC.html` `R.sld`: transformers, bus, UPS, DG (static), feeders. Feeder positions bind to seeded assets via `SLD_FEEDERS`.

## `CracSchematic`

Sprint 7 cooling loop aligned with `R.crac`: CRAC 101 detail panel, compressor bank (one cell per CRAC 101–104), chilled-water runs, chiller/pump/tower narrative, zone tiles. Uses `HVAC_POINT_KEYS` from the simulator.
