# ADR 0018 — Separate the spatial axis from the telemetry-source axis

## Status

Accepted (2026-08-05). Amends ADR 0008 (Organization → Location → RTU → Asset →
Point Key hierarchy).

Unblocks `F1.8` and `F1.9`. A companion ADR will cover location depth.

## Context

ADR 0008 established `Organization → Location → RTU → Asset → Point Key` as a
single containment ladder, modelled on TeleCash's source shape. That ladder
merges two independent things: **where an asset is** and **how its data
arrives**. An RTU is a communications device, not a place.

Two consequences are live on `main` today.

**1. `bms.assets.rtu_id` is `NOT NULL`** — an asset cannot exist unless a
gateway feeds it. The seed works around this by fabricating gateways:
`packages/db/src/hierarchy-seed.ts:70` inserts `'{"synthetic":true}'::jsonb`
rows for every (location × domain) pair, and line 155 carries the guard
`"Cannot enforce NOT NULL: assets without rtu_id remain"`. Measured on the
seeded database: **40 of 52 RTU rows are synthetic, and exactly 1 of 52 has
`ingest_enabled`.** Roughly three quarters of the table exists to satisfy a
constraint rather than to describe a device.

**2. `bms.assets.location_id` is nullable** — yet it is the column every scoped
authorization check filters on (`inArray(assets.locationId, locationIds)` on
the read path, `canManageLocation` on the write path). An asset with a null
location is silently invisible to every location-scoped user, with no error.

The mandatory/optional flags are therefore inverted relative to how the
application actually uses them: the axis authorization never consults is
required, and the axis it depends on is optional.

Research across seven independent sources found **no standard or platform that
places a communications device inside the spatial hierarchy**:

- **IEC 62264 (ISA-95)** defines three separate hierarchies — functional
  (Purdue L1–4), role-based equipment, and (ed. 2, §5.4) physical asset. A
  `physical asset` is *"used in equipment roles"* — assigned to a role, not a
  rung above it. RTUs and PLCs sit at Purdue Level 1.
- **Project Haystack**: *"All points must be associated with a site via the
  `siteRef` tag and a specific piece of equipment via the `equipRef` tag."* The
  source axis (`deviceRef` / `networkRef`) is absent from that requirement.
  Every point carries exactly one function marker — `sensor`, `cmd`, `sp`
  (*"setpoint, internal control variable, schedule, soft point"*) or
  `synthetic` (*"computed data"*) — so a point with no source is first-class,
  not an orphan.
- **Zoho IoT**, our named parity benchmark, puts `located_at` and
  `connected_gateway` on the asset as independent fields: *"Data is stored in
  the asset only when the asset is associated to the device using the connected
  gateway field."* The gateway gates **data, not existence**.
- **AWS IoT SiteWise** binds the source via `propertyAlias` on an individual
  property; `CreateGateway` accepts no asset or hierarchy parameter.
- **Brick Schema** attaches the BACnet reference to the Point via
  `ref:hasExternalReference`.
- **Siemens Desigo CC** and **JCI Metasys** keep separate trees (Management
  View → Field Networks → Hardware → Device, versus the logical / Spaces
  trees). Metasys runs four.
- **Schneider PME** states the ordering outright: devices are registered in
  Management Console first, then Hierarchy Manager layers the logical view on
  top.

Two camps exist on *where* the source binds: at the point (Haystack, SiteWise,
Brick) or at a device node with points beneath it (Desigo, Metasys). This ADR
takes the point-level option, because it is the one that lets a single asset
mix sources.

## Decision

1. **`bms.assets.location_id` becomes `NOT NULL`.** The backfill is a no-op —
   measured 0 null locations across 147 assets. This closes the silent
   invisibility hole: every asset becomes reachable by location-scoped
   authorization.

2. **`bms.assets.rtu_id` becomes nullable.** An asset must be somewhere; it
   need not be wired.

3. **The telemetry source reference moves to `bms.asset_points`** as a nullable
   `rtu_id` referencing `bms.rtus`. `asset_points` already holds
   `source_data_key` with no source of its own — provenance was inherited
   implicitly from `assets.rtu_id`, imposing 1:N on a relationship that is N:M
   in practice. One asset can legitimately carry a Modbus point, a manual
   monthly reading, and a computed point.

4. **Add `bms.asset_points.source_kind`** —
   `measured | manual | computed | unmapped`, `NOT NULL DEFAULT 'unmapped'`.
   A nullable `rtu_id` alone is ambiguous: it cannot distinguish "not yet
   mapped" from "entered by hand" from "derived". Haystack requires exactly one
   function marker for precisely this reason. Enforced by a CHECK constraint:
   `measured` requires `rtu_id`; the other three require it to be null.

   **`unmapped` and the default were added after review.** The first draft
   offered only three kinds and defaulted to `measured`, which was wrong twice
   over. It made "not yet mapped" — the state the column was introduced to
   express — the one state unrepresentable, forcing two independent call sites
   to record a gateway-less point as `manual`: a provenance claim nobody made.
   And defaulting to `measured` turned every existing INSERT that omitted
   `rtu_id` into a runtime constraint violation. Defaulting to `unmapped` means
   a writer that supplies neither column produces a valid row describing
   exactly what it knows. This also matters for `F1.9`, where measured points
   are legitimately imported before their gateway is wired.

5. **The seed stops re-applying the old constraint.** `hierarchy-seed.ts` ran
   `ALTER TABLE bms.assets ALTER COLUMN rtu_id SET NOT NULL` on every
   `db:seed`, so a migration alone would have been silently undone on the next
   seed — including in CI, which runs `db:migrate` then `db:seed`. That guard
   now enforces `location_id` instead. `verify-hierarchy-seed.ts` asserted the
   same dead invariant and is re-pointed too.

   **The seed still fabricates `{"synthetic":true}` RTU rows, and this ADR no
   longer asks it to stop.** An earlier draft did. That was wrong: the simulator
   demo navigates assets through `/admin/locations/:id/rtus/:rtuId/assets`, and
   `resolveEskomSimRtuId` structurally depends on those rows, so removing them
   would leave Eskom's 147 demo assets unreachable by that route on a fresh
   database while existing databases kept them — fresh and existing installs
   disagreeing. The schema no longer *requires* those rows, which is the
   substantive change; whether the demo keeps using them is a separate
   product call, not a schema one. Retiring them stays follow-up work.

6. **Scope limit.** This ADR changes the source axis only. Location depth
   (`locations.parent_id`), asset composition (`parent_asset_id`), and the
   Eskom-era `locations.type` union (`smoc_campus | rsmoc | csmoc`) are out of
   scope here and belong to the companion ADR.

## Dependencies

**None.** No new npm package. One forward-only migration under `packages/db`,
which takes the migration lock — the drizzle journal is a single shared file,
so only one migration-bearing job may run at a time.

## Consequences

**Positive.** `F1.8` (manual time-series entry) and `F1.9` (telemetry bulk
import) unblock — both P0, Wave 0, both previously unrepresentable without a
fake gateway. The silent-invisibility bug closes as a side effect of decision 1.
An asset can carry points from more than one source. The seed stops
manufacturing rows that describe nothing.

**Negative.** Every read path that reached the source through `assets.rtu_id`
must now go through `asset_points`. `apps/ingest/src/rtu-config.js` resolves
per-RTU configuration and will need the point-level reference. Two places know
about sources until the synthetic rows are retired.

**Deferred.** Retiring the 40 existing synthetic RTU rows; asset composition;
location depth.

**Decided here, implemented elsewhere.** A grant on a parent location **does**
imply access to its descendants. This has no effect today — no location has a
parent — and becomes load-bearing the moment location depth lands, so it is
recorded now rather than re-litigated later. It must ship with the companion
ADR's migration, not before, and must be explicitly tested: it silently widens
access, which is the failure mode that will not announce itself.

**Risk accepted.** `source_kind` is enforced by a CHECK constraint rather than
by Zod at the controller boundary. Adding a schema-level enum is owed when
`F1.8`/`F1.9` expose the field to callers.

An earlier draft of this section claimed `F1.8`/`F1.9` would be the *first*
writers of `asset_points`. **That was false, and the review caught it.** Two
writers already exist — `asset-points.service.ts` (`POST /admin/asset-points`)
and `onboarding-commit.service.ts` (the ADR 0011 wizard commit) — and both
omitted the new columns, so against the original `DEFAULT 'measured'` both
would have returned 500 on every call. Neither is covered by a test, and the
seed supplies the columns explicitly, so **CI would have stayed green while two
endpoints were dead.** Both now set provenance; the default change in decision
4 removes the failure mode at its root rather than only at these two sites.

## Verification

- A migration test asserting an asset can be created with `rtu_id IS NULL` and
  rejected with `location_id IS NULL` — the two polarities, both directions.
- A test asserting the `source_kind` CHECK rejects `measured` without an
  `rtu_id` and `manual`/`computed` with one.
- A test asserting `hierarchy-seed.ts` never re-applies
  `assets.rtu_id SET NOT NULL`, and that `verify-hierarchy-seed.ts` no longer
  asserts the deleted invariant — the two places a migration can be silently
  undone at seed time. Verified by re-injecting the statement and confirming
  the suite fails.
- `pnpm db:migrate && pnpm db:seed` against a **genuinely fresh** database, not
  an incrementally migrated one. The two differ: on an existing database the
  seed takes its `ON CONFLICT` update path and never exercises the insert that
  the new `location_id` constraint rejects.

## Owed follow-up

Per AGENTS.md §9.10, a separate `chore(agents):` commit records the axis
separation in AGENTS.md §3 alongside the repository layout, so the next reader
does not re-derive `assets.rtu_id` as a hierarchy edge. Nothing in AGENTS.md §6
is promoted by this ADR — §6 does not list schema or hierarchy work.
