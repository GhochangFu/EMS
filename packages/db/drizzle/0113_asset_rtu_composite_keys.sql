-- F4.132 / F4.137 / ADR 0102 -- composite keys hold an asset's organization and
-- an RTU to their location.
--
-- Four constraints, all NO ACTION on delete and on update, all MATCH SIMPLE
-- (a NULL rtu_id skips the RTU key):
--   rtus_id_location_key                     UNIQUE (id, location_id) on bms.rtus.
--     It is only the target of the last key; `id` is the primary key, so it
--     never refuses a row.
--   rtus_location_id_organization_id_fkey    (location_id, organization_id)
--     -> bms.locations (id, organization_id): an RTU sits in its location's
--     organization.
--   assets_location_id_organization_id_fkey  (location_id, organization_id)
--     -> bms.locations (id, organization_id): an asset sits in its location's
--     organization (F4.132).
--   assets_rtu_id_location_id_fkey           (rtu_id, location_id)
--     -> bms.rtus (id, location_id): a wired asset's RTU is at the asset's own
--     location (F4.137, location form; the organization form is implied by the
--     other three and is not added -- ADR 0102 decision 2).
-- The referential check runs with row security off, so each key refuses across
-- tenants whatever the caller can see. The target
-- locations_id_organization_key exists since 0103 and is reused.
--
-- REFUSE, NEVER REPAIR. Step 2 counts the rows each key would refuse and
-- raises with the counts if any is above zero. This migration rewrites no row.
-- The counts run after RESET ROLE: bms.rtus and bms.assets carry FORCE ROW
-- LEVEL SECURITY, so bms_owner under SET ROLE with no GUC would count 0 and
-- report success (0085 header). The unique is DDL and reads no row, so it runs
-- inside the bms_owner bracket, as in 0103.
--
-- NO POLICY OR PRIVILEGE CHANGE.
--
-- RE-RUNNABLE. Each ADD CONSTRAINT sits behind a pg_constraint probe. The
-- counts stand outside the probes on purpose: with the keys present they count
-- 0 and the second run exits 0. Forward-only, no down migration (AGENTS.md
-- section 4.4).
SET ROLE bms_owner;

-- 1. K4's target.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_id_location_key'
      AND conrelid = 'bms.rtus'::regclass
  ) THEN
    ALTER TABLE bms.rtus
      ADD CONSTRAINT rtus_id_location_key UNIQUE (id, location_id);
  END IF;
END $$;

RESET ROLE;

-- 2. Refuse, never repair.
DO $$
DECLARE
  rtu_org_drift   bigint;
  asset_org_drift bigint;
  asset_rtu_drift bigint;
BEGIN
  SELECT count(*) INTO rtu_org_drift
    FROM bms.rtus r JOIN bms.locations l ON l.id = r.location_id
   WHERE l.organization_id <> r.organization_id;
  SELECT count(*) INTO asset_org_drift
    FROM bms.assets a JOIN bms.locations l ON l.id = a.location_id
   WHERE l.organization_id <> a.organization_id;
  SELECT count(*) INTO asset_rtu_drift
    FROM bms.assets a JOIN bms.rtus r ON r.id = a.rtu_id
   WHERE a.location_id <> r.location_id;

  IF rtu_org_drift > 0 OR asset_org_drift > 0 OR asset_rtu_drift > 0 THEN
    RAISE EXCEPTION
      'migration 0113: live data disagrees - rtus_location_id_organization_id_fkey: % row(s), assets_location_id_organization_id_fkey: % row(s), assets_rtu_id_location_id_fkey: % row(s)',
      rtu_org_drift, asset_org_drift, asset_rtu_drift
      USING HINT = 'Repair the rows by hand (ADR 0102 decision 3): the asset or RTU takes its location''s organization, and a wired asset''s rtu_id must name an RTU at the asset''s own location. This migration never rewrites a row.';
  END IF;
END $$;

-- 3. An RTU sits in its location's organization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_location_id_organization_id_fkey'
      AND conrelid = 'bms.rtus'::regclass
  ) THEN
    ALTER TABLE bms.rtus ADD CONSTRAINT rtus_location_id_organization_id_fkey
      FOREIGN KEY (location_id, organization_id)
      REFERENCES bms.locations (id, organization_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- 4. An asset sits in its location's organization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_location_id_organization_id_fkey'
      AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets ADD CONSTRAINT assets_location_id_organization_id_fkey
      FOREIGN KEY (location_id, organization_id)
      REFERENCES bms.locations (id, organization_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- 5. A wired asset's RTU is at the asset's own location.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_rtu_id_location_id_fkey'
      AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets ADD CONSTRAINT assets_rtu_id_location_id_fkey
      FOREIGN KEY (rtu_id, location_id)
      REFERENCES bms.rtus (id, location_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- 6. Proof: all four exist, and the foreign keys are NO ACTION both ways.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_id_location_key'
      AND conrelid = 'bms.rtus'::regclass
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'migration 0113: rtus_id_location_key is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_location_id_organization_id_fkey'
      AND conrelid = 'bms.rtus'::regclass
      AND contype = 'f'
      AND confdeltype = 'a' AND confupdtype = 'a'
  ) THEN
    RAISE EXCEPTION 'migration 0113: rtus_location_id_organization_id_fkey is missing or not NO ACTION both ways';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_location_id_organization_id_fkey'
      AND conrelid = 'bms.assets'::regclass
      AND contype = 'f'
      AND confdeltype = 'a' AND confupdtype = 'a'
  ) THEN
    RAISE EXCEPTION 'migration 0113: assets_location_id_organization_id_fkey is missing or not NO ACTION both ways';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_rtu_id_location_id_fkey'
      AND conrelid = 'bms.assets'::regclass
      AND contype = 'f'
      AND confdeltype = 'a' AND confupdtype = 'a'
  ) THEN
    RAISE EXCEPTION 'migration 0113: assets_rtu_id_location_id_fkey is missing or not NO ACTION both ways';
  END IF;
END $$;
