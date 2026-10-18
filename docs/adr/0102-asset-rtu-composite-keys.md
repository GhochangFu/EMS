# ADR 0102 — Composite keys hold an asset's organization and RTU to its location (`F4.132`, `F4.137`)

## Status

Accepted — owner ruling 2026-10-18, drafted before code. The owner approved the
mechanism (composite foreign keys in the ADR 0098 pattern, refuse-not-repair),
the four-key set below, the superuser-with-constraints-off fixtures and the
position that an ancestor-node RTU is not a feature. *Drafter choice 1* (the
location form of the RTU key) is for the owner to confirm when this record is
read.

Implements rows `F4.132` and `F4.137`. Promotes nothing out of `AGENTS.md` §6.

## Context

Two backlog rows ask the database to hold what the code already derives:

- **`F4.132`** — `bms.assets.organization_id` and `bms.assets.location_id` are
  two columns that must agree (the asset's organization is its location's), and
  no constraint relates them. `AssetsService`, instantiation and the onboarding
  commit each derive the organization from the location before the write.
- **`F4.137`** — `bms.assets.rtu_id` is a plain foreign key to `bms.rtus.id`. A
  probe as `bms_tenant`, with the PHEWB organization in the GUC, inserted an
  asset with an ESKOM `rtu_id` and the insert succeeded: the referential check
  runs with row security off, so the key proves the RTU exists and nothing
  more. The same gap holds for the RTU's own `organization_id` against its
  location (the `F4.138` drift).

The live data has 0 mismatches on all three relations, and no current writer can
reach the state: every one of them resolves the agreeing values first
(`assertRtuLocation`, `resolveLocationOrg`, `resolveAgreedOrg`,
`locationBelongsToOrganization`). The gap is a backstop for the next writer, an
import or a hand-run statement. Migration `0103` set the precedent: a composite
key `(parent_id, organization_id) -> (id, organization_id)` on `bms.locations`,
with `locations_id_organization_key` as its target.

## Decision

1. **Four constraints**, all `ON DELETE NO ACTION ON UPDATE NO ACTION`, all
   `MATCH SIMPLE` (a NULL `rtu_id` skips the key):

   | Key | Table | Definition |
   |---|---|---|
   | `rtus_id_location_key` | `bms.rtus` | `UNIQUE (id, location_id)` — the target of the fourth; it never refuses a row, because `id` is the primary key |
   | `rtus_location_id_organization_id_fkey` | `bms.rtus` | `FOREIGN KEY (location_id, organization_id) REFERENCES bms.locations (id, organization_id)` |
   | `assets_location_id_organization_id_fkey` | `bms.assets` | `FOREIGN KEY (location_id, organization_id) REFERENCES bms.locations (id, organization_id)` |
   | `assets_rtu_id_location_id_fkey` | `bms.assets` | `FOREIGN KEY (rtu_id, location_id) REFERENCES bms.rtus (id, location_id)` |

   The target `locations_id_organization_key` exists since `0103` and is reused.
2. **The organization form of the RTU key is not added** (`assets(rtu_id,
   organization_id) -> rtus(id, organization_id)`, the form `F4.137` names). With
   the other three it is implied: asset.org = location(asset).org (K3);
   asset.location = rtu.location (K4); rtu.org = location(rtu).org (K2) =
   location(asset).org = asset.org. A fifth key would add a unique index on
   `rtus` and no claim. The location form is the one that makes the
   organization form redundant; the reverse is not true.
3. **Migration `0113` refuses with per-key counts and never repairs.** A
   `RAISE EXCEPTION` names each key and its disagreeing row count. The counts
   and the three `ADD CONSTRAINT` statements run after `RESET ROLE`, because
   `bms.rtus` and `bms.assets` carry `FORCE ROW LEVEL SECURITY` and a count
   under `bms_owner` with no GUC reads 0 (the `0085` header). The unique runs
   inside the `bms_owner` bracket, as in `0103`: it is DDL and reads no row.
4. **The single-column foreign keys stay** (`assets_location_id_locations_id_fk`,
   `assets_rtu_id_rtus_id_fk`, `rtus_location_id_locations_id_fk`). The API maps
   a 23503 on the last one by name.
5. **The service pre-checks stay** as the first refusal; the key is the
   backstop. A 23503 on a new name is unreachable through the API and would be a
   500, as today's `assets_rtu_id_rtus_id_fk` would be. A fixture that plants a
   now-forbidden row does so as the superuser with `session_replication_role =
   replica` (the `calc-parameters.tree` precedent) and deletes the row in
   teardown, so the guard it tests stays gated.
6. **K4 pins "an asset's RTU is at the asset's own node"** (ADR 0018, ADR 0098
   ruling 3). An RTU on an ancestor node serving child-node assets is not a
   feature. If the owner rules one in, a later migration drops K4 together with
   the equality in `assertRtuLocation`.

## Security

The referential check runs with row security off, so each key refuses across
tenants whatever the caller can see. This is the `0072` and `0103` claim. The
23503 detail names the constraint and the supplied pair only, which is less than
the plain foreign key leaked (it confirmed an RTU in another tenant exists).
There is no policy or privilege change.

## Consequences

- `phe-pilot-seed.ts` upserts RTUs with `ON CONFLICT ... DO UPDATE SET
  location_id`. That statement fails under K4 if a station of an RTU with wired
  assets is re-mapped between seeds. A re-seed with unchanged values is skipped
  by the referential equality check.
- Three fixtures run `UPDATE bms.locations SET organization_id`. They pass,
  because their locations hold no RTU.
- The committed-fixture suites hold foreign-key-violating rows between plant and
  teardown, as they did before.
- Five fixture suites change how they plant a row (decision 5).

## Verification owed

- A static spec pins the migration text and the Drizzle mirrors.
- An integration file proves each key refuses a disagreeing write as
  `bms_tenant`, `bms_owner` and the superuser, and accepts a consistent one,
  on the insert, update and referenced sides.
- A cold start on a scratch database, a second migrate that applies nothing, and
  a guard-refusal run with one planted disagreeing row.
- CI logs show both new `tests/` files and the five modified suites by name.
