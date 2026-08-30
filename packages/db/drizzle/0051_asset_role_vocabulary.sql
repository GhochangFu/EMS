-- F3.37 / ADR 0049 decision 5 — the asset role vocabulary.
--
-- A role says what part a member plays IN THAT GROUP: "the incoming supply",
-- "a chiller". `F3.36` binds a section-template widget to a named position
-- rather than a uuid; `F3.28` labels a per-class health strip; `F3.32` anchors
-- a mimic node. One lookup table plus one nullable column on the junction.
--
-- WHY THE ROLE LIVES ON THE MEMBERSHIP AND NOT ON THE ASSET (decision 5). The
-- same pump is the raw-water pump in the water group and a monitored load in
-- the electrical one, and the mock's STP and ETP trains share equipment
-- classes. A column on `bms.assets` would assert one role everywhere. Deriving
-- it from `assets.template_id` was declined on a sharper case: `template_id`
-- says what an asset IS, not what part it PLAYS, and two identical pumps from
-- one template fill different roles in one train.
--
-- WHY THIS TABLE IS GLOBAL AND CARRIES NO `organization_id`, NO RLS AND NO
-- POLICY. It is the fifth table of the class `0047` deliberately left alone:
-- `asset_domains`, `rule_categories`, `alarm_severities` and `alarm_skills` get
-- no ENABLE ROW LEVEL SECURITY there. Two reasons beyond the precedent. ADR
-- 0049 decision 3's stock catalog only works if a role code means the same
-- thing in every organization — an imported stock template resolves
-- `incoming-supply`, and a per-tenant vocabulary would resolve it differently
-- per tenant. And a nullable `organization_id` with NULL meaning global is the
-- shape decision 3 rejected outright, on `E7.1c` and ADR 0043 Amendment 5.
--
-- ADR 0049's Consequences says of the two migrations it schedules: "Both
-- forward-only and both tenant-scoped in the migration that creates them."
-- THAT SENTENCE IS TRUE OF `F3.36`'s `bms.dashboard_templates` AND FALSE HERE.
-- Ruled at the F3.37 plan gate on 2026-08-30, on the evidence above.
-- `tests/f3.37-asset-role-vocabulary.test.ts` is the only thing that holds it.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING HERE, AND NOT FOR THE USUAL REASON.
-- Not for `FORCE ROW LEVEL SECURITY` — there is none on this table. For
-- `0041_bms_owner_and_force_rls` lines 112-113: `ALTER DEFAULT PRIVILEGES FOR
-- ROLE bms_owner IN SCHEMA bms GRANT ... TO bms_tenant, bms_fleet`, which fires
-- only for objects created by the role it names. `pnpm db:migrate` connects as
-- DATABASE_URL_SUPERUSER (`bms_app`). Without the bracket `bms.asset_roles`
-- would be owned by `bms_app`, the default privileges would never fire, and
-- `VocabulariesService` — which injects TENANT_DRIZZLE, i.e. `bms_tenant` —
-- could not read it. `0039`'s comment records that this failure surfaces "one
-- endpoint at a time", which here means inside `F3.36`, long after this file.
-- The four existing vocabulary tables escaped it only because they predate
-- `0039`/`0041`.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it. A hand-written GRANT would be redundant and
-- would hide a future breakage of the SET ROLE bracket. (`0050`'s header.)
--
-- The ALTER TABLE in step 4 needs no bracket of its own — ownership does not
-- change on ALTER TABLE, and `bms.asset_group_members` is already owned by
-- `bms_owner`. Do not add one by symmetry.
--
-- NO `organization_id` IS ADDED TO THE JUNCTION. `0046`'s own text names
-- junctions as deliberately column-free, `tests/adr-0043-tenant-columns.test.ts`
-- asserts it, and `0047` lines 223-240 already give `bms.asset_group_members` a
-- `tenant_isolation` policy through BOTH parents, with FORCE.
--
-- Forward-only and idempotent.

SET ROLE bms_owner;

-- 1. The role vocabulary, as data — not a z.enum and not a CHECK.
--
--    §4.8's test as ADR 0032 rewrote it: ask whether the behaviour can be
--    carried as data. A widget type's behaviour is a React component and a
--    metric's is a SQL query, so ADR 0047 decision 2 and ADR 0048 decision 1
--    both closed theirs. A ROLE'S BEHAVIOUR IS "MATCH THIS MEMBER", WHICH IS
--    THE CODE ITSELF — a role declared by an INSERT arrives fully functional.
--    So a lookup table, exactly as ADR 0031 and ADR 0032 ruled for rule
--    categories and alarm severities. Do not reach for a z.enum and a CHECK
--    here on the strength of `F3.1a`; it is the opposite case.
--
--    Column for column with `bms.asset_domains`. `sort_order`, not `rank`: a
--    role carries no urgency the way severity does. No `tone`: a role drives
--    no styling.
--
--    `code` is the primary key rather than a surrogate uuid because domain
--    packs and stock dashboard templates round-trip through JSON, which code
--    references survive and uuids do not — the reason `template_points`
--    `point_key` records and `asset_domains` restates.
--
--    NO `domain` COLUMN, ruled at the F3.37 plan gate on 2026-08-30. A foreign
--    key to `bms.asset_domains` would have forced two new rows (`stp`, `etp`)
--    into the vocabulary `assets.domain` and `asset_templates.domain` read,
--    which changes the plant-domain picker for every organization — a product
--    decision about the asset domain vocabulary, not a display tweak inside
--    this row. The picker groups by the `sort_order` bands in step 2 instead.
--    That is a convention and not a gate, and it is stated as one. The
--    filter question returns properly in `F3.36`/`F3.28`, when a train is
--    actually rendered. Cost of being wrong: one forward-only migration adding
--    a nullable column, with nothing to backfill.
CREATE TABLE IF NOT EXISTS bms.asset_roles (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the starting role list from the client mock's own node labels.
--
--    Source: `docs/ion-exchange-nexus-dashboard-2026-08-29.html`, the five
--    trains of the System Overview diagram. Nothing here is invented — an
--    unused role is easy to add, a wrong one is hard to retire, because the
--    foreign key in step 4 carries no ON DELETE by design.
--
--    CODES ARE SINGULAR, LABELS ARE THE MOCK'S STRINGS VERBATIM, ruled at the
--    F3.37 plan gate on 2026-08-30. The code names what ONE asset is; the
--    label names what the tile shows. `role = 'chillers'` on a single chiller
--    would read as a mistake in any psql query.
--
--    `sort_order` is banded per train with room to insert: Electrical 110-160,
--    Water 210-250, STP 310-360, ETP 410-440, HVAC 510-550. Spaced by ten
--    inside a band, matching migration 0030's severity spacing and 0034's.
--
--    27 nodes, 26 codes: THE ETP TRAIN REUSES `equalization`. `code` is the
--    primary key of a global table, so the role exists exactly once and both
--    trains share it. Resolution is safe as-is — ADR 0049 decision 4 resolves
--    a role against THE TARGET ASSET GROUP'S MEMBERS, so a shared
--    `equalization` never crosses trains. Do not add an `stp-`/`etp-` prefix
--    defensively; only the picker is affected, and that was ruled above.
--
--    Bare `ON CONFLICT DO NOTHING` — no conflict target — for the reason 0030
--    and 0034 both give: a named `(code)` arbiter would let a collision on some
--    other unique constraint abort the whole transaction on a re-run.
--
--    This insert joins nothing that `pnpm db:seed` creates, so it is safe
--    inside `db:migrate`, which always runs first. Do not add a mirror
--    seeding path to `seed.ts`.
INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  -- Electrical
  ('incoming-supply',     'Incoming',       110),
  ('transformer',         'Transformer',    120),
  ('ht-panel',            'HT Panels',      130),
  ('lt-panel',            'LT Panels',      140),
  ('mcc',                 'MCCs',           150),
  ('utilities',           'Utilities',      160),
  -- Water
  ('raw-intake',          'Raw Intake',     210),
  ('pump-house',          'Pump House',     220),
  ('treatment',           'Treatment',      230),
  ('oht-tank',            'OHT / Tanks',    240),
  ('distribution',        'Distribution',   250),
  -- STP
  ('inlet-screen',        'Inlet Screen',   310),
  ('equalization',        'Equalization',   320),
  ('aeration',            'Aeration',       330),
  ('secondary-clarifier', 'Sec. Clarifier', 340),
  ('disinfection',        'Disinfection',   350),
  ('treated-tank',        'Treated Tank',   360),
  -- ETP (reuses `equalization` above)
  ('neutralization',      'Neutralization', 410),
  ('biological',          'Biological',     420),
  ('settling',            'Settling',       430),
  ('discharge',           'Discharge',      440),
  -- HVAC
  ('chiller',             'Chillers',       510),
  ('cooling-tower',       'Cooling Tower',  520),
  ('primary-pump',        'Primary Pumps',  530),
  ('ahu-fcu',             'AHU / FCU',      540),
  ('zone',                'Zones',          550)
ON CONFLICT DO NOTHING;

-- 3. The role on the membership.
--
--    NULLABLE, because every existing membership has no role and a NOT NULL
--    would need a default, which would be a claim. `0029` dropped
--    `assets.domain`'s `DEFAULT 'electrical'` for exactly that reason: a
--    default that silently classifies unstated plant is how a vocabulary
--    drifts unnoticed (`F4.43`).
--
--    A FOREIGN KEY, NEVER A CHECK — see step 1.
--
--    NO `ON DELETE` CLAUSE, by design, so a delete of a role that plant still
--    references fails loudly. Retire a role with `active = false`.
--
--    varchar(64) matches `asset_roles.code`'s width, getting it right at
--    creation rather than widening it later the way `alarms.severity` needed.
ALTER TABLE bms.asset_group_members
  ADD COLUMN IF NOT EXISTS role varchar(64) REFERENCES bms.asset_roles(code);

-- 4. The lookup index for role resolution.
--
--    NOT UNIQUE, AND THAT IS THE DECISION, NOT AN OVERSIGHT. A role matching
--    several members is the norm: the mock's own nodes are plural — "HT Panels
--    2 · all good", "Pump House 2 of 3 running", "Chillers 2 of 3 · 74%",
--    "Primary Pumps 3 running", and one `utilities` node covering DG, UPS and
--    Solar. ADR 0049 decision 4 rejected binding an ASSET TYPE because the
--    WIDGET COUNT would then vary until instantiation, so a template could not
--    state its own grid layout. One role still maps to one widget however many
--    members match, and `WIDGET_POINT_CARDINALITY` already ships
--    `chart: { min: 1, max: MAX_WIDGET_POINTS }` — a many-binding widget is an
--    existing, grid-stable shape.
--
--    Do not add UNIQUE here later without reading that paragraph. Migrations
--    are forward-only, so adding and dropping one costs two files and an
--    explanation. `tests/f3.37-asset-role-vocabulary.test.ts` holds it.
--
--    Not CONCURRENTLY: it cannot run in a transaction block and the drizzle
--    migrator wraps every file.
CREATE INDEX IF NOT EXISTS asset_group_members_group_role_idx
  ON bms.asset_group_members (asset_group_id, role);

RESET ROLE;
