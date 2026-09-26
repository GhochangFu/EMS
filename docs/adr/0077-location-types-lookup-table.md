# ADR 0077 — The location type becomes a lookup table (`F4.157`)

## Status

Accepted — drafted on 2026-09-26, before any implementation code. Six scope
questions were put to the owner one at a time; all six were ruled, and each
ruling is recorded under *Gate questions*. The owner reviewed and approved this
written record on 2026-09-26.

Implements row `F4.157`, which [ADR 0076](./0076-control-room-for-each-organization.md)
decision 12 created with its own ADR. Promotes nothing out of `AGENTS.md` §6.

## Context

**The observation (ADR 0076, Q16).** All six `PHEWB` locations — Lotapata,
Bilsi, Salkumarhat, Mora Nodir Kuthi, BhutnirGhat, Banchukamari — carry type
`rsmoc`, because no other value exists. The owner ruled that PHE has no
relation to Eskom's SMOC/RSMOC. They are pump stations.

**What the code does today (measured 2026-09-26 at `0a9fcba5`).**

- `bms.locations.type` is `varchar(32) NOT NULL` with **no CHECK and no FK**
  (`\d bms.locations` on the live DB). The fixed list lives only in code.
- Live rows: `ESKOM` 1 `smoc_campus`, 9 `rsmoc`, 1 `csmoc`; `PHEWB` 6 `rsmoc`.
- The list `["smoc_campus", "rsmoc", "csmoc"]` is repeated in:
  - `apps/api/src/admin/locations/locations.schema.ts:3` (`locationTypeSchema`)
  - `packages/shared/src/contracts/admin.ts:39`, `auth.ts:57`,
    `dashboard.ts:42`, `onboarding.ts:164`
  - `apps/api/src/admin/onboarding/onboarding.schema.ts:64`
  - `apps/api/src/dashboard/dashboard.service.ts:52` (a literal union)
  - `apps/web/src/pages/admin/locations-page.tsx:46, 355–357` (three hardcoded
    `<option>`s)
  - the seeds: `phe-pilot-seed.ts:185`, `phe-map-seed.ts:38`,
    `eskom-locations-seed.ts:89`, `map-locations-seed.ts:149, 167`, and the
    `row.kind === "rsmoc"` demo-asset filter in `seed.ts:120`.
- **Onboarding coerces silently.** The Excel parser maps any value that is not
  `rsmoc` or `csmoc` to `smoc_campus` (`onboarding-excel.service.ts:448–450`).
  The chat service guesses from the message text — `rsmoc` → `rsmoc`, `csmoc` →
  `csmoc`, else `smoc_campus` (`onboarding-chat.service.ts:484–488`). A PHE
  upload therefore becomes an Eskom SMOC campus without a message.
- **The map is a second vocabulary.** `bms.map_locations.kind` holds 31
  `eskom_station` pins and 16 site pins (15 `rsmoc`, 1 `csmoc`), also with no
  CHECK or FK. `map.service.ts` joins `bms.locations` on `slug`.
  `isOperationalLocation` — in both `map.service.ts:28` and `world-map.tsx:29` —
  tests the three fixed kinds to decide whether a pin carries live health, and
  `locationKindLabel` (`world-map.tsx:37`) hardcodes the labels. The PHE pins
  show "RSMOC". `mapSiteDtoSchema.kind` (`dashboard.ts:169`) is
  `z.enum(["eskom_station", "smoc_campus", "rsmoc", "csmoc"])`.
- **Re-seeding.** `phe-pilot-seed.ts` re-writes `bms.locations.type` on every
  run (the update branch sets it). `seedMapLocations` only inserts missing pins,
  so a re-seed never changes an existing `map_locations.kind`.
- `provinceCode("West Bengal")` is `undefined`, so `demoAssetsForRsmoc` makes
  no demo assets for PHE today, whatever its kind.

**The rule this follows.** A vocabulary that grows per sector is data, not an
enum: a lookup table with a foreign key, extended with an `INSERT`, not a
migration plus a deploy. `bms.notification_channel_kinds` (migration `0038`)
and `bms.point_keys` are the precedents.

## Gate questions

Ruled by the owner on 2026-09-26, one at a time.

1. **Ownership.** **Ruled: one global table.** No organization column, no
   RLS. Rows change only by a migration (or, later, a global administrator).
   Rejected: a per-organization table; a global table plus a per-organization
   visibility join.
2. **Initial rows.** **Ruled: the three Eskom types unchanged, plus
   `pump_station`.** All six PHE sites become `pump_station`. Any other type
   (for example a water-treatment plant for `E5.1`) comes later as one
   `INSERT`.
3. **The map.** **Ruled: the map reads the location type.** A pin that joins a
   location takes its type and label from `bms.locations.type` and
   `bms.location_types.label`. `map_locations.kind` keeps `eskom_station` for
   the pins that join no location. Rejected: an FK from `map_locations.kind` to
   the lookup (it would need an `eskom_station` row and an "operational" flag);
   deferring the map (the PHE pins keep showing "RSMOC").
4. **Moving the PHE rows.** **Ruled: migration and seeds.** The migration
   updates the existing rows; the seeds write `pump_station` so a cold start
   agrees. Rejected: seeds only (existing map pins stay `rsmoc`).
5. **Onboarding.** **Ruled: reject an unknown type, with no default.** Rejected:
   a default for an empty cell; keeping the coercion.
6. **Admin surface.** **Ruled: a read endpoint only.** A page to create, rename
   or deactivate types is deferred to a new backlog row. Rejected: read plus
   global-admin CRUD in this row (about double the effort).

## Decision

1. **`bms.location_types`** — a global lookup table:
   `code varchar(32) PRIMARY KEY`, `label varchar(128) NOT NULL`,
   `sort_order integer NOT NULL DEFAULT 0`, `active boolean NOT NULL DEFAULT
   true`, `created_at timestamptz NOT NULL DEFAULT now()`. No
   `organization_id`, no RLS. It is created as `bms_owner` like `0082`, so the
   default privileges grant it. `bms_tenant` then holds **SELECT only** — the
   migration revokes its write privileges, as `0059` did for `bms.point_keys` —
   because the list is fleet-wide master data.
2. **Seeded rows** (`INSERT ... ON CONFLICT DO NOTHING`, no conflict target,
   as `0038` explains): `smoc_campus` "SMOC campus", `rsmoc` "RSMOC",
   `csmoc` "CSMOC", `pump_station` "Pump station".
3. **`bms.locations.type` gets a foreign key** to `bms.location_types(code)`.
   The migration adds it after the data move in decision 4, and the migration
   reviewer checks that every existing row resolves before it validates.
4. **Data move, in the same migration.** `UPDATE bms.locations SET type =
   'pump_station'` for the locations of organization `PHEWB`, and `UPDATE
   bms.map_locations SET kind = 'pump_station'` for the map pins whose `slug`
   joins one of those locations. Both are idempotent. The migration reads a
   policied table, so it runs as the superuser. The seeds change to match:
   `phe-pilot-seed.ts` and `phe-map-seed.ts` write `pump_station`, and the
   seed filters that list the three Eskom kinds (`eskom-locations-seed.ts:89`,
   `seed.ts:120`) keep their current output — no Eskom row moves and no new
   demo asset appears.
5. **Contracts.** Every `z.enum(["smoc_campus", "rsmoc", "csmoc"])` for a
   location type becomes a bounded string (`z.string().min(1).max(32)`), and
   the literal union in `dashboard.service.ts:52` becomes `string`. The write
   paths — the admin locations service and the onboarding commit — refuse a
   code that is not an **active** row with a 400 that names the valid codes.
   The foreign key is the backstop, not the message. `mapSiteDtoSchema.kind`
   becomes a string and gains `kindLabel`.
6. **The map.** For a pin that joins a location, `map.service.ts` returns the
   location's type as `kind` and the lookup's `label` as `kindLabel`. "Carries
   live health" becomes "joins a location" (`canonical_location_id` is not
   null), in both `map.service.ts` and `world-map.tsx`. `world-map.tsx` shows
   `kindLabel` and keeps "Station" for `eskom_station`; the hardcoded label
   switch goes. A PHE pin must still carry `live` — a test gates it, because
   no compiler notices a pin that silently loses health.
7. **Onboarding rejects an unknown type.**
   - Excel: a type cell that is not an active code is a row error that lists
     the valid codes. An empty cell is also a row error. The template's example
     row uses a valid code.
   - Chat: the service matches the message against the active codes and
     labels. If nothing matches, the next turn asks for the type and offers the
     active labels as the suggestions. It never falls back to `smoc_campus`.
8. **Read endpoint.** `GET /api/v1/admin/location-types` returns the active
   rows ordered by `sort_order`, then `code`, as `{ code, label }`, with a Zod
   response contract in `packages/shared/src/contracts/` (ADR 0030). The admin
   locations page fills its type dropdown from it; the three hardcoded
   `<option>`s go. The guard is the same as the admin locations endpoints.
9. **Tests.** An integration test proves the FK refuses an unknown code, the
   service refuses an inactive code, and `bms_tenant` cannot write the table.
   A cold start (init, roles, migrate, seed on a scratch DB) proves the seeds
   and the migration agree. The browser checks that the six PHE pins and the
   admin locations page show "Pump station".

## Consequences

- **A new location type is one `INSERT`**, not a migration of the enum plus a
  release of the API and the web bundle.
- **The PHE sites stop claiming to be Eskom RSMOCs** — on the map, in the admin
  page, in every DTO that carries the type.
- **Onboarding becomes stricter.** A spreadsheet with an empty or unknown type,
  which today imports as `smoc_campus`, now fails with a row error. That is the
  intent: the old result was wrong data without a message.
- **The contracts widen from an enum to a string.** A web consumer that
  switches on the three literals loses exhaustiveness checking. The plan
  enumerates the consumers by the `.parse(` call and by the literals, not by
  the compiler.
- **`map_locations.kind` stays a separate, unconstrained column** for
  `eskom_station`. Constraining it is not part of this row.
- **Deferred:** a global-admin page to create, rename and deactivate location
  types — a new backlog row, raised when this row closes.
- The Control Room (ADR 0076) does not read the location type, so no view
  changes.
