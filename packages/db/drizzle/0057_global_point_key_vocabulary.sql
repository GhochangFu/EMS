-- F3.39 / ADR 0051 decisions 2, 3 and 4 — the point-key vocabulary becomes
-- global, and `bms.asset_points` is constrained against it.
--
-- A section dashboard template names four things. Three of them — the section
-- code, the `assetRoleCode` and the metric `catalogKey` — are already global.
-- `bms.point_keys` was not: it carried `organization_id NOT NULL`, a unique
-- index on `(organization_id, code)`, and `tenant_isolation` with FORCE. So a
-- future organization could legitimately spell the same quantity differently
-- and every stock template would then miss. That contradicts the owner's
-- ruling, recorded as ADR 0051 decision 1, that a template must serve every
-- organization present and future.
--
-- THE ONE-ROW PROOF THAT THE PER-TENANT SPLIT WAS THE DEFECT. Measured on the
-- running stack on 2026-09-01: 16 `(organization, key)` pairs sit on assets and
-- outside their own organization's catalog. Fifteen are codes in NO catalog at
-- all — PHEWB's pilot meters read `kwh_total`, `kva`, six `voltage_v*`, three
-- `current_i*`, `chlorine_pump_on`, `battery_charge_pct`, `network_strength`
-- and `controller_power_status`, none of which the ESKOM-derived seed knows.
-- The sixteenth is PHEWB's `frequency_hz` — WHICH ESKOM'S CATALOG ALREADY
-- NAMES. A real meter reading was an orphan for no reason but the tenant axis,
-- and the merge repairs that one by itself. `tests/f3.39-global-point-key-
-- vocabulary.test.ts` holds the shape; the counts belong to the §4.6 check.
--
-- THE MERGE IS NON-LOSSY, AND THAT IS MEASURED RATHER THAN ASSUMED. ESKOM
-- holds 34 codes and PHEWB 15; PHEWB's are a strict subset. Across the two
-- organizations no shared code disagrees on `name`, `domain`, `unit`,
-- `description` or `active` — zero rows, all five columns. So any survivor of
-- the dedupe in step 2 is content-identical to the row it replaces, and the
-- table goes from 49 rows to 34 with nothing to reconcile.
--
-- THIS TABLE JOINS THE GLOBAL-VOCABULARY CLASS `0047` DELIBERATELY LEFT ALONE:
-- `asset_domains`, `rule_categories`, `alarm_severities`, `alarm_skills`,
-- `asset_roles` (`0051`) and `dashboard_sections` (`0056`). It is the first
-- member to ARRIVE there rather than to be born there, so unlike the others it
-- has a policy to drop and duplicates to collapse.
--
-- A TENANT BOUNDARY IS REMOVED, AND THAT IS STATED RATHER THAN BURIED. After
-- this, every organization sees every point-key code. A code is a measurement
-- name: it names no asset, no site and no value, so it discloses nothing about
-- another tenant's estate. `bms.asset_points` and `telemetry.point_values`,
-- which DO name those things, keep their policies untouched. The write path
-- narrows as the read path widens — `PointKeysAdminService` gates create,
-- update, deactivate and reactivate on the global `admin` role, because
-- fleet-wide master data must not be editable by a tenant administrator.
--
-- ============================================================================
-- WHY THIS FILE LEAVES THE `SET ROLE bms_owner` BRACKET HALF WAY THROUGH, AND
-- WHY THAT IS THE LOAD-BEARING LINE IN IT.
-- ============================================================================
--
-- `bms.asset_points` carries `FORCE ROW LEVEL SECURITY` (`0047`). `bms_owner`
-- is its owner and is NOT `BYPASSRLS`, so FORCE binds it, and with no
-- `app.current_organization` set its `tenant_isolation` policy compares
-- `organization_id` to NULL and matches nothing. MEASURED, not reasoned:
--
--     SET ROLE bms_owner; SELECT COUNT(*) FROM bms.asset_points;  -->  0
--
-- Step 5 derives the orphan codes FROM `bms.asset_points`. Run inside the
-- bracket it would read zero rows, insert nothing, report success, and leave
-- step 6's foreign key to abort the migration on rows step 5 was written to
-- admit. Step 6 is worse: an FK validates existing rows on creation, and a
-- validation that can see none is a constraint that passed vacuously.
--
-- So steps 1-4 run as `bms_owner` and steps 5-6 run as the migration's own
-- connection, which is `DATABASE_URL_SUPERUSER` (`bms_app`) and bypasses RLS
-- outright. Nothing is lost by that: `0041` lines 112-113 grant default
-- privileges for objects CREATED BY `bms_owner`, and steps 5-6 create no table
-- — an INSERT grants nothing, and a constraint's index belongs to the table's
-- owner rather than to the role that adds it. DO NOT "tidy" the RESET ROLE
-- away by pulling steps 5-6 back inside the bracket. The migration will still
-- apply on an empty database, and will still fail on every seeded one.
--
-- `id` STAYS THE PRIMARY KEY; `code` TAKES A UNIQUE INDEX INSTEAD. Corrected on
-- 2026-09-01 against the F3.39 row's own first draft, which said `code` becomes
-- the primary key. A foreign-key target needs only a unique index, while
-- `GET`/`PATCH /api/v1/admin/point-keys/:id`, the audit `entityId` and
-- `tests/integration-fixture-isolation.test.ts` all key on `id`.
-- `bms.asset_roles` uses `code` as its primary key because it was born that way
-- and has no id-keyed caller; this table has four.
--
-- Forward-only and idempotent. Steps 2 and 5 guard on state rather than on
-- `IF EXISTS`, because a DELETE and an INSERT ... SELECT carry no such clause.

SET ROLE bms_owner;

-- 1. Take the tenant policy off first.
--
--    Order matters only in that this must precede nothing in particular — but
--    doing it first means every later step in this file reads and writes the
--    table with no policy in play, which is one fewer thing to reason about
--    when a step goes wrong.
DROP POLICY IF EXISTS tenant_isolation ON bms.point_keys;
ALTER TABLE bms.point_keys NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.point_keys DISABLE ROW LEVEL SECURITY;

-- 2. Collapse the duplicates, THEN drop the tenant axis.
--
--    THE DEDUPE IS THE STEP THE F3.39 ROW'S FIRST DRAFT DID NOT HAVE, AND
--    WITHOUT IT STEP 3 ABORTS. The table holds 49 rows over 34 distinct codes,
--    so a unique index on `code` alone fails on 15 duplicate pairs. It runs
--    here, while `organization_id` still exists, so a reader can see what was
--    collapsed rather than finding a bare `row_number()` over a flat table.
--
--    `row_number()`, NOT `min(id)`: `min(uuid)` DOES NOT EXIST in PostgreSQL
--    and the statement fails to plan. Checked against the running server
--    before this file was written.
--
--    The ORDER BY is deterministic and it is not arbitrary, even though the
--    measurement above says every survivor is content-identical: prefer an
--    active row, then one that carries a description, then the lowest id. If a
--    database somewhere HAS drifted, those three keep the more informative row.
--
--    The whole block is guarded on `organization_id` still existing. That is
--    the idempotency key for all three statements — a re-run finds the column
--    gone and does nothing, which is the correct answer for a DELETE that
--    `IF EXISTS` cannot express.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'bms'
      AND table_name = 'point_keys'
      AND column_name = 'organization_id'
  ) THEN
    DELETE FROM bms.point_keys AS pk
    USING (
      SELECT id,
             row_number() OVER (
               PARTITION BY code
               ORDER BY active DESC, description NULLS LAST, id
             ) AS rn
      FROM bms.point_keys
    ) AS ranked
    WHERE ranked.id = pk.id
      AND ranked.rn > 1;

    ALTER TABLE bms.point_keys
      DROP CONSTRAINT IF EXISTS point_keys_organization_id_organizations_id_fk;

    DROP INDEX IF EXISTS bms.point_keys_org_code_unique;

    ALTER TABLE bms.point_keys DROP COLUMN IF EXISTS organization_id;
  END IF;
END $$;

-- 3. `code` becomes unique across the fleet.
--
--    This is what makes a stock dashboard template resolvable: ADR 0051
--    decision 2's whole claim is that a code means the same quantity in every
--    organization, and nothing enforced that while the uniqueness was scoped.
--
--    A unique INDEX rather than a unique CONSTRAINT: both satisfy a foreign
--    key's requirement on the referenced column, and an index is what `0018`
--    used for the pair it replaces. Not CONCURRENTLY — it cannot run in a
--    transaction block and the drizzle migrator wraps every file.
CREATE UNIQUE INDEX IF NOT EXISTS point_keys_code_unique
  ON bms.point_keys (code);

RESET ROLE;

-- 4. Admit the orphans. Runs as `bms_app`, NOT as `bms_owner` — see the header.
--
--    DERIVED FROM `bms.asset_points`, NEVER SPELLED OUT AS A VALUES LIST. A
--    hand-copied list is a snapshot of one database: it would admit exactly the
--    15 codes measured here and silently miss an orphan on any other install,
--    which step 5 would then report as a constraint violation with no clue as
--    to which key caused it.
--
--    `domain` COMES FROM THE OWNING ASSET; `unit` IS LEFT NULL. The domain is a
--    fact the database already holds, and it is single-valued — measured, no
--    orphan code spans two asset domains. A unit is not: these codes arrive
--    from `phe-pilot-seed.ts`'s TeleCash sensor map, which carries none, and a
--    guessed unit is a claim rather than a record. An admin fills it in through
--    the point-key surface, and a NULL unit is already the normal case for a
--    boolean-valued point (`breaker_main`, `pf`).
--
--    `name` is `initcap(replace(code, '_', ' '))`, which is the same string
--    `point-keys-seed.ts`'s own `titleCase` produces for a seeded code, so a
--    reader cannot tell a repaired row from a seeded one by its label.
--
--    Bare `ON CONFLICT DO NOTHING` — no conflict target — for the reason `0030`
--    and `0034` both give: a named arbiter would let a collision on some other
--    unique constraint abort the whole transaction on a re-run. `DISTINCT ON`
--    collapses the twelve asset rows each code carries.
INSERT INTO bms.point_keys (code, name, domain, unit, active)
SELECT DISTINCT ON (ap.point_key)
  ap.point_key,
  initcap(replace(ap.point_key, '_', ' ')),
  a.domain,
  NULL::varchar(32),
  true
FROM bms.asset_points AS ap
JOIN bms.assets AS a ON a.id = ap.asset_id
WHERE NOT EXISTS (
  SELECT 1 FROM bms.point_keys AS pk WHERE pk.code = ap.point_key
)
ORDER BY ap.point_key, a.domain
ON CONFLICT DO NOTHING;

-- 5. The vocabulary becomes a constraint. ADR 0051 decision 4.
--
--    THIS MUST FOLLOW STEP 4, IN THIS FILE AND NEVER A LATER ONE. Split across
--    two migrations there is a window in which `db:migrate` succeeds and the
--    constraint this row exists to add is quietly absent; run before step 4 it
--    aborts on the 16 pairs.
--
--    NO `ON DELETE` CLAUSE, by design and for `0051`'s reason: a delete of a
--    code that plant still records must fail loudly. Retire a code with
--    `active = false`, which is what the admin surface already does.
--
--    NO `ON UPDATE` CLAUSE either. A code is an identifier, not a label; the
--    admin surface has never allowed `code` to be edited after creation.
--
--    `varchar(128)` on both sides already, so nothing widens.
--
--    Guarded on `pg_constraint` rather than `IF NOT EXISTS`, which PostgreSQL
--    does not accept on `ADD CONSTRAINT`. The name is spelled explicitly so
--    the guard and the constraint cannot drift apart.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'asset_points_point_key_point_keys_code_fk'
      AND conrelid = 'bms.asset_points'::regclass
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_point_key_point_keys_code_fk
      FOREIGN KEY (point_key) REFERENCES bms.point_keys(code);
  END IF;
END $$;
