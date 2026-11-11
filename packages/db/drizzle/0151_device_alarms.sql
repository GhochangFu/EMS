-- F3.16 / ADR 0127 decision 12 - device alarms in bms.alarms (plan
-- docs/plans/f3.16-device-health.md unit B1 and section 6). Renumbered from 0150:
-- PR A used 0149 and 0150 (ADR 0127 Build notes).
--
--   asset_id        drops NOT NULL: a device alarm has no asset
--   source          'rule' (every existing row, the default), 'rtu_comms'
--                   ("Communication lost", one RTU) or 'ingest_host' ("Ingest
--                   host not reporting", one per organization)
--   rtu_id          the silent RTU of an 'rtu_comms' alarm
--
-- THE SHAPE PER SOURCE (alarms_source_shape_check). A 'rule' alarm has an asset
-- and no RTU (rule_id stays nullable: pre-0032 rows carry none). An 'rtu_comms'
-- alarm has an RTU, no asset and no rule. An 'ingest_host' alarm has neither an
-- asset, an RTU nor a rule. alarms_source_check closes the vocabulary on its own,
-- so an unknown source is named as such rather than as a bad shape.
--
-- THE KEY. rtu_id references bms.rtus (id, organization_id), the 0149 idiom: the
-- referential check runs with row security off, so a single-column key would let
-- an alarm in organization A name an RTU of organization B. The target,
-- rtus_id_organization_id_key, exists since 0149. ON DELETE NO ACTION, like
-- alarms.asset_id and alarms.rule_id: an alarm is history, and no route deletes
-- an RTU (deactivation is the lifecycle).
--
-- THE DEDUPE (alarms_open_per_device_uidx). At most one open (uncleared) alarm per
-- organization, source and RTU; COALESCE(rtu_id, organization_id) makes the
-- 'ingest_host' key one per organization, since a NULL never collides in a
-- unique index. Partial on source <> 'rule', so it matches no existing row and
-- the rule dedupe (alarms_open_per_rule_uidx, 0066) is untouched. AlarmRaiser's
-- bare ON CONFLICT DO NOTHING arbitrates on either index.
--
-- LOCKS. DROP NOT NULL and ADD COLUMN ... DEFAULT with a constant are catalog-only;
-- the CHECKs are added NOT VALID (a brief ACCESS EXCLUSIVE, no scan) and then
-- validated (SHARE UPDATE EXCLUSIVE, writes continue); the partial index matches
-- no row. lock_timeout bounds the wait on a busy alarms table.
--
-- WHY THIS FILE WRITES NO GRANT. No object is created that needs one: the columns
-- inherit the table's privileges and bms_owner owns bms.alarms (0041). Policies
-- are unchanged: tenant_isolation on organization_id already binds every source.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT
-- EXISTS, every ADD CONSTRAINT behind a pg_constraint probe, DROP NOT NULL and
-- VALIDATE are no-ops on a replay. No statement-breakpoint markers (the 0038
-- reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

ALTER TABLE bms.alarms ALTER COLUMN asset_id DROP NOT NULL;

ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'rule';

ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS rtu_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_rtu_id_organization_id_fkey' AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_rtu_id_organization_id_fkey FOREIGN KEY (rtu_id, organization_id)
        REFERENCES bms.rtus (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_source_check' AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_source_check CHECK (source IN ('rule', 'rtu_comms', 'ingest_host')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_source_shape_check' AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_source_shape_check CHECK (
        (source = 'rule' AND asset_id IS NOT NULL AND rtu_id IS NULL)
        OR (source = 'rtu_comms' AND rtu_id IS NOT NULL AND asset_id IS NULL AND rule_id IS NULL)
        OR (source = 'ingest_host' AND asset_id IS NULL AND rtu_id IS NULL AND rule_id IS NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE bms.alarms VALIDATE CONSTRAINT alarms_source_check;

ALTER TABLE bms.alarms VALIDATE CONSTRAINT alarms_source_shape_check;

CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_per_device_uidx
  ON bms.alarms (organization_id, source, COALESCE(rtu_id, organization_id))
  WHERE cleared_at IS NULL AND source <> 'rule';

COMMENT ON COLUMN bms.alarms.source IS 'rule, rtu_comms or ingest_host; the shape per source is alarms_source_shape_check (ADR 0127 decision 12).';
COMMENT ON COLUMN bms.alarms.rtu_id IS 'The silent RTU of an rtu_comms alarm (ADR 0127 decision 12).';

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator: a constraint left NOT VALID, a column still NOT
-- NULL, or an index under another name all read correct above and guard nothing.
DO $$
DECLARE
  wanted text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'bms.alarms'::regclass AND attname = 'asset_id' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'migration 0151: bms.alarms.asset_id is still NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'bms.alarms'::regclass AND attname = 'source' AND attnotnull
  ) THEN
    RAISE EXCEPTION 'migration 0151: bms.alarms.source is missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'bms.alarms'::regclass AND attname = 'rtu_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'migration 0151: bms.alarms.rtu_id is missing';
  END IF;

  FOREACH wanted IN ARRAY ARRAY[
    'alarms_rtu_id_organization_id_fkey',
    'alarms_source_check',
    'alarms_source_shape_check'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = wanted AND conrelid = 'bms.alarms'::regclass AND convalidated
    ) THEN
      RAISE EXCEPTION 'migration 0151: constraint % is missing or not validated on bms.alarms', wanted;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid = 'bms.alarms'::regclass AND ic.relname = 'alarms_open_per_device_uidx'
       AND i.indisunique AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'migration 0151: partial unique index alarms_open_per_device_uidx is missing on bms.alarms';
  END IF;
END $$;
