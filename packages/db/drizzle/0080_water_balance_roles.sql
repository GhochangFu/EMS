-- E4.3 / ADR 0073 decision 1 — the per-asset water balance role.
--
-- ADR 0073's `sustainability-overview` fix needs to know which asset's inlet
-- is the site's water INTAKE, which asset's outlet DISCHARGEs off-site, which
-- outlet is REUSEd on-site, and which asset is INTERNAL to the plant (neither
-- flow crosses the site boundary). One role per asset; the ADR records that a
-- split flow (part reused, part discharged) is a recorded limitation until
-- `F2.10`'s real asset topology lands.
--
-- SHAPE, COPIED COLUMN FOR COLUMN FROM `0051_asset_role_vocabulary.sql`
-- (`bms.asset_roles`, ADR 0049 decision 5) — the same reasoning applies
-- verbatim and is not restated here beyond what differs:
--
--   * A lookup table, not a `z.enum` and not a CHECK. §4.8's test as ADR 0032
--     rewrote it: a role's behaviour is "match this asset", which IS the
--     code, so a role declared by an INSERT arrives fully functional.
--   * `code` is the primary key (survives a JSON round-trip; a surrogate uuid
--     would not).
--   * `sort_order`, not `rank` — a balance role carries no urgency.
--   * `SET ROLE bms_owner` / `RESET ROLE` IS LOAD-BEARING for the same reason
--     as `0051`: not `FORCE ROW LEVEL SECURITY` (there is none on this
--     table), but `0041_bms_owner_and_force_rls` lines 112-113's
--     `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT ... TO
--     bms_tenant, bms_fleet`, which fires only for objects created by the
--     role it names. `pnpm db:migrate` connects as `bms_app`
--     (`DATABASE_URL_SUPERUSER`); without the bracket the table would be
--     owned by `bms_app`, the default privileges would never fire, and
--     `VocabulariesService` (which reads through `TENANT_DRIZZLE`, i.e.
--     `bms_tenant`) could not read it.
--   * THEREFORE NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE
--     ADDED — the default privileges do it, and a hand-written GRANT would
--     hide a future breakage of the SET ROLE bracket (`0050`'s header).
--   * `bms.water_balance_roles` IS GLOBAL — NO `organization_id`, NO RLS, NO
--     POLICY. A role code must mean the same thing in every organization,
--     exactly the reasoning `0051`'s header gives for `bms.asset_roles`
--     (ADR 0049 decision 3's stock catalog only works if a role code
--     resolves identically per tenant; a nullable `organization_id` with
--     NULL meaning global is the shape `E7.1c` / ADR 0043 Amendment 5
--     rejected outright).
--
-- THE `bms.assets.water_balance_role` COLUMN IS NULLABLE, NO DEFAULT, NO
-- `ON DELETE` — the `0051` reason restated for this table: every asset
-- written before this migration has no role, and a default would be a claim
-- (the reason `0029` dropped `assets.domain`'s `DEFAULT 'electrical'`). NULL
-- means "not in the balance" (ADR 0073 decision 1). No `ON DELETE` so a
-- delete of a role a plant still references fails loudly; retire a role with
-- `active = false`.
--
-- NO INDEX ON THE COLUMN. `sustainability-rollup.ts`'s roll-up already filters
-- the carrying set down to a small `scope` id list before applying the role
-- predicate, so a b-tree on `water_balance_role` would not be selective
-- enough to earn its upkeep. State the decision here rather than add one by
-- reflex.
--
-- Forward-only and idempotent.

SET ROLE bms_owner;

-- 1. The role vocabulary, as data — not a z.enum and not a CHECK.
CREATE TABLE IF NOT EXISTS bms.water_balance_roles (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the four codes ADR 0073 decision 1 names. Bare `ON CONFLICT DO
--    NOTHING` — no arbiter — for the `0030`/`0034`/`0051` reason: a named
--    `(code)` arbiter would let a collision on some other unique constraint
--    abort the whole transaction on a re-run.
INSERT INTO bms.water_balance_roles (code, label, sort_order) VALUES
  ('intake',    'Intake',    10),
  ('discharge', 'Discharge', 20),
  ('reuse',     'Reuse',     30),
  ('internal',  'Internal',  40)
ON CONFLICT DO NOTHING;

-- 3. The role on the asset. Nullable, no default, no ON DELETE — see header.
--    A FOREIGN KEY, never a CHECK — see header.
ALTER TABLE bms.assets
  ADD COLUMN IF NOT EXISTS water_balance_role varchar(64)
    REFERENCES bms.water_balance_roles(code);

RESET ROLE;
