-- F3.42 / ADR 0051 Amendment 3 — `bms.template_points.point_key` is held to the
-- fleet-wide catalog, the same way `0057` held `bms.asset_points.point_key`.
--
-- WHY THIS IS POSSIBLE NOW AND WAS NOT BEFORE. ADR 0015 §3 reason 2 refused
-- this constraint, and its reasoning was sound: `bms.point_keys` was unique on
-- `(organization_id, code)`, so a foreign key would have forced a denormalized
-- `organization_id` onto this child row — a second source of truth that can
-- drift. `0057` removed the premise. `code` is unique by itself now, so a plain
-- single-column reference needs no denormalization at all. The ADR's conclusion
-- is not wrong; it is simply no longer implied by anything.
--
-- MEASURED BEFORE IT WAS WRITTEN, on the running stack on 2026-09-01:
-- `bms.template_points` holds 15 rows carrying 14 distinct codes, and ZERO of
-- them are absent from `bms.point_keys`. So on this database step 1 is a guard
-- and not a repair, and step 2 adds a constraint that already holds.
--
-- STEP 1 REFUSES AN ORPHAN RATHER THAN ADMITTING IT, AND THAT IS A DELIBERATE
-- ASYMMETRY WITH `0057`. ADR 0051 decision 3 admitted `asset_points`' sixteen
-- orphans into the vocabulary. It could, because an `asset_points` orphan is a
-- MEASUREMENT A DEVICE ACTUALLY CARRIES — refusing it would refuse a fact. A
-- `template_points` orphan is AUTHORED TEXT. `F3.38`'s entire failure was eight
-- camelCase names typed into the stock catalog that matched no vocabulary;
-- admitting one automatically would turn that typo into permanent fleet-wide
-- vocabulary, which is the defect ADR 0051 exists to close, arriving through
-- the other door. ADR 0051 Amendment 3 decision 3 records the ruling.
--
-- AND THE REFUSAL NAMES THE CODES. A bare `ADD CONSTRAINT` failure reports only
-- `template_points_point_key_point_keys_code_fk` and a row count, leaving an
-- operator to bisect their templates by hand. This is the reason
-- `AssetTemplatesService.assertPointKeysActive` names every offending code,
-- applied one layer down.
--
-- STEP 1 RUNS AS `bms_app` AND STEP 2 AS `bms_owner`, AND THAT ORDER IS
-- LOAD-BEARING RATHER THAN TIDY. `bms.template_points` carries
-- `tenant_isolation` with FORCE since `0047`, and `bms_owner` is NOT
-- `BYPASSRLS` (`rolbypassrls = f`, measured). A read of the table as the owner
-- with no `app.current_organization` set therefore returns ZERO ROWS, and the
-- guard would pass vacuously on a database full of orphans — proving nothing at
-- the exact moment it matters most. The migrator connects as
-- `DATABASE_URL_SUPERUSER` (`bms_app`, `BYPASSRLS`), so step 1 must simply stay
-- OUTSIDE the role bracket. Step 2 must be inside it, because only the table's
-- owner may `ALTER` it.
--
-- Forward-only and idempotent. Step 2 guards on `pg_constraint` rather than on
-- `IF NOT EXISTS`, which PostgreSQL does not accept on `ADD CONSTRAINT`.

-- 1. The guard. As `bms_app`, deliberately outside the role bracket below.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(DISTINCT tp.point_key, ', ' ORDER BY tp.point_key)
    INTO offending
    FROM bms.template_points AS tp
   WHERE NOT EXISTS (
     SELECT 1 FROM bms.point_keys AS pk WHERE pk.code = tp.point_key
   );

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 0058: these template point keys are in no fleet-wide catalog: %',
      offending
      USING HINT =
        'Register each code in bms.point_keys, or correct the template that names it. '
        || 'ADR 0051 Amendment 3 decision 3: an authored orphan is not admitted '
        || 'automatically, because a typed name must not become fleet-wide vocabulary.';
  END IF;
END $$;

-- 2. The constraint. As the table owner.
--
--    NO `ON DELETE` CLAUSE, for `0057` step 5's reason: a delete of a code a
--    template still names must fail loudly. Retire a code with `active = false`,
--    which is what the admin surface already does — and which this constraint
--    deliberately cannot enforce, leaving `assertPointKeysActive` its own job.
--
--    NO `ON UPDATE` CLAUSE either. A code is an identifier, not a label; the
--    admin surface has never allowed `code` to be edited after creation.
--
--    `varchar(128)` on both sides already, so nothing widens.
SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'template_points_point_key_point_keys_code_fk'
      AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_point_key_point_keys_code_fk
      FOREIGN KEY (point_key) REFERENCES bms.point_keys(code);
  END IF;
END $$;

RESET ROLE;
