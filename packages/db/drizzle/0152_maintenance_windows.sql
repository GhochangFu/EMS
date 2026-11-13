-- F4.359 / ADR 0131 decision 17 - maintenance windows (plan
-- docs/plans/f4.359-maintenance-windows.md unit U1; owner ruling Q2 adds the
-- third alarm column).
--
--   bms.maintenance_windows         one window: a reason, a period, an optional
--                                   early end (ended_at/ended_by: end or cancel),
--                                   an optional work-order or schedule link
--   bms.maintenance_window_targets  what a window covers: exactly one of an
--                                   asset, a location (with its subtree) or a rule
--   bms.alarms.suppressed_at        when a window began to suppress the alarm
--   bms.alarms.suppressed_by_window_id  the window that did; kept after a lift
--                                   (history), replaced by a later window's id
--   bms.alarms.unsuppressed_at      when suppression was lifted: the moment the
--                                   alarm returns as new and its escalation
--                                   clock restarts (ruling Q2)
--
-- THE PARENT KEYS. A composite foreign key needs a unique key on the referenced
-- pair. locations (locations_id_organization_key) and users already carry one;
-- assets and automation_rules gain (id, organization_id) here, and
-- maintenance_schedules gains a unique index on (organization_id, id), the 0144
-- idiom for work_orders (work_orders_organization_id_id_key). Each is unique
-- because id is, so none refuses an existing row; each exists only to be
-- referenced.
--
-- THE KEYS ARE COMPOSITE ON organization_id, the 0149 reason: the referential
-- check runs with row security off, so a single-column key would let a window of
-- organization A target an asset, location or rule of B, link B's work order, or
-- be named by B's alarm. A window's organization is derived from its targets
-- (plan D1); these keys say the same in SQL. Every key is NO ACTION except the
-- targets' window key, which cascades: a target is part of its window. No route
-- deletes a window, an asset, a location or a rule (the plan, section 1).
--
-- THE CHECKS. maintenance_windows: a reason of 3 to 2000 characters after trim,
-- ends_at after starts_at, ended_at and ended_by set together. The 7-day bound is
-- the service's, not a CHECK: an extension may carry the total past 7 days (plan
-- D3). maintenance_window_targets: exactly one target (num_nonnulls = 1).
-- bms.alarms (alarms_suppressed_shape_check): a suppressed alarm names its
-- window, and an 'ingest_host' alarm is never suppressed (ADR 0131 decision 5).
-- The alarms CHECK is added NOT VALID, then validated; every existing row has
-- NULL stamps and passes. The new tables are empty, so their CHECKs are inline.
--
-- ROW LEVEL SECURITY. Both tables carry organization_id, ENABLE and FORCE, and the
-- strict tenant_isolation policy (USING and WITH CHECK, no NULL disjunct): with
-- the setting unset they match nothing (ADR 0043, 0045).
--
-- WHY THIS FILE WRITES NO GRANT. The tenant pool writes windows through
-- withTenant (plan U3), so 0041's default privileges (DML for bms_tenant on every
-- table bms_owner creates) are exactly what is wanted; nothing is revoked. The
-- alarm columns inherit the table's privileges.
--
-- LOCKS. pnpm db:migrate runs every pending migration in ONE transaction, so
-- every lock below is held until COMMIT: ACCESS EXCLUSIVE on bms.alarms (ADD
-- COLUMN, the CHECK and its VALIDATE scan), on assets and automation_rules (the
-- two UNIQUE index builds), SHARE ROW EXCLUSIVE on each referenced table. Raises
-- and other writes WAIT for the commit; they do not run alongside. bms.alarms is
-- locked first, the order a raise takes (alarms, then its assets FK check), so a
-- raise in flight cannot deadlock the migration. lock_timeout (5 s) bounds every
-- wait: on a busy database a timeout rolls the whole batch back cleanly; stop the
-- api, worker, sim and ingest, or retry.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent: tables, columns and indexes are IF NOT EXISTS, the
-- policies are dropped before they are created, every ADD CONSTRAINT sits behind a
-- pg_constraint probe, VALIDATE is a no-op on a replay. No statement-breakpoint
-- markers (the 0038 reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

-- bms.alarms first: the lock order of a raise (alarms, then the assets FK check).
ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;

ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS suppressed_by_window_id uuid;

ALTER TABLE bms.alarms ADD COLUMN IF NOT EXISTS unsuppressed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assets_id_organization_id_key' AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets ADD CONSTRAINT assets_id_organization_id_key UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_rules_id_organization_id_key' AND conrelid = 'bms.automation_rules'::regclass
  ) THEN
    ALTER TABLE bms.automation_rules ADD CONSTRAINT automation_rules_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_schedules_organization_id_id_key
  ON bms.maintenance_schedules (organization_id, id);

CREATE TABLE IF NOT EXISTS bms.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  reason text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by uuid REFERENCES bms.users(id),
  work_order_id uuid,
  maintenance_schedule_id uuid,
  created_by uuid NOT NULL REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_windows_id_organization_id_key UNIQUE (id, organization_id),
  CONSTRAINT maintenance_windows_reason_check CHECK (char_length(btrim(reason)) BETWEEN 3 AND 2000),
  CONSTRAINT maintenance_windows_period_check CHECK (ends_at > starts_at),
  CONSTRAINT maintenance_windows_ended_shape_check CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  CONSTRAINT maintenance_windows_work_order_fkey FOREIGN KEY (organization_id, work_order_id)
    REFERENCES bms.work_orders (organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT maintenance_windows_maintenance_schedule_fkey FOREIGN KEY (organization_id, maintenance_schedule_id)
    REFERENCES bms.maintenance_schedules (organization_id, id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- The open windows of an organization, by end: the raiser's and the sweep's read
-- (ended_at IS NULL AND starts_at <= now() AND ends_at > now(), plan D2).
CREATE INDEX IF NOT EXISTS maintenance_windows_open_ends_at_idx
  ON bms.maintenance_windows (organization_id, ends_at) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS bms.maintenance_window_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  asset_id uuid,
  location_id uuid,
  rule_id uuid,
  CONSTRAINT maintenance_window_targets_one_target_check CHECK (num_nonnulls(asset_id, location_id, rule_id) = 1),
  CONSTRAINT maintenance_window_targets_window_fkey FOREIGN KEY (window_id, organization_id)
    REFERENCES bms.maintenance_windows (id, organization_id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT maintenance_window_targets_asset_fkey FOREIGN KEY (asset_id, organization_id)
    REFERENCES bms.assets (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT maintenance_window_targets_location_fkey FOREIGN KEY (location_id, organization_id)
    REFERENCES bms.locations (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT maintenance_window_targets_rule_fkey FOREIGN KEY (rule_id, organization_id)
    REFERENCES bms.automation_rules (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- One target of each kind once per window. Each leads with window_id, so the
-- window's own reads use them too.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_window_targets_asset_uidx
  ON bms.maintenance_window_targets (window_id, asset_id) WHERE asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_window_targets_location_uidx
  ON bms.maintenance_window_targets (window_id, location_id) WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_window_targets_rule_uidx
  ON bms.maintenance_window_targets (window_id, rule_id) WHERE rule_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_suppressed_by_window_id_organization_id_fkey' AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_suppressed_by_window_id_organization_id_fkey
        FOREIGN KEY (suppressed_by_window_id, organization_id)
        REFERENCES bms.maintenance_windows (id, organization_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_suppressed_shape_check' AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_suppressed_shape_check CHECK (
        (suppressed_at IS NULL OR suppressed_by_window_id IS NOT NULL)
        AND (source <> 'ingest_host' OR suppressed_at IS NULL)
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE bms.alarms VALIDATE CONSTRAINT alarms_suppressed_shape_check;

ALTER TABLE bms.maintenance_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_windows FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_window_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_window_targets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.maintenance_windows;
CREATE POLICY tenant_isolation ON bms.maintenance_windows
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.maintenance_window_targets;
CREATE POLICY tenant_isolation ON bms.maintenance_window_targets
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

COMMENT ON TABLE bms.maintenance_windows IS 'A maintenance window: alarms it covers are suppressed between starts_at and ends_at, or ended_at (ADR 0131).';
COMMENT ON TABLE bms.maintenance_window_targets IS 'What a maintenance window covers: exactly one asset, location (with its subtree) or rule per row (ADR 0131).';
COMMENT ON COLUMN bms.alarms.suppressed_at IS 'When a maintenance window began to suppress this alarm; NULL when not suppressed (ADR 0131).';
COMMENT ON COLUMN bms.alarms.suppressed_by_window_id IS 'The window that last suppressed this alarm; kept after the lift (ADR 0131).';
COMMENT ON COLUMN bms.alarms.unsuppressed_at IS 'When suppression was lifted: the alarm returns as new and its escalation clock starts here (ADR 0131).';

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator: RLS that is not forced, a policy missing a half, a
-- constraint left NOT VALID or under another name, or a missing column all read
-- correct above and guard nothing.
DO $$
DECLARE
  wanted text;
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['maintenance_windows', 'maintenance_window_targets'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class
       WHERE relnamespace = 'bms'::regnamespace AND relname = tbl
         AND relrowsecurity AND relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0152: bms.% is missing or its row level security is not enabled and forced', tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relnamespace = 'bms'::regnamespace AND c.relname = tbl
         AND p.polname = 'tenant_isolation' AND p.polqual IS NOT NULL AND p.polwithcheck IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration 0152: bms.% has no tenant_isolation policy with USING and WITH CHECK', tbl;
    END IF;
  END LOOP;

  FOREACH wanted IN ARRAY ARRAY[
    'assets_id_organization_id_key',
    'automation_rules_id_organization_id_key',
    'maintenance_windows_id_organization_id_key',
    'maintenance_windows_reason_check',
    'maintenance_windows_period_check',
    'maintenance_windows_ended_shape_check',
    'maintenance_windows_work_order_fkey',
    'maintenance_windows_maintenance_schedule_fkey',
    'maintenance_window_targets_one_target_check',
    'maintenance_window_targets_window_fkey',
    'maintenance_window_targets_asset_fkey',
    'maintenance_window_targets_location_fkey',
    'maintenance_window_targets_rule_fkey',
    'alarms_suppressed_by_window_id_organization_id_fkey',
    'alarms_suppressed_shape_check'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = wanted AND connamespace = 'bms'::regnamespace AND convalidated
    ) THEN
      RAISE EXCEPTION 'migration 0152: constraint % is missing or not validated', wanted;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid = 'bms.maintenance_schedules'::regclass
       AND ic.relname = 'maintenance_schedules_organization_id_id_key' AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'migration 0152: unique index maintenance_schedules_organization_id_id_key is missing';
  END IF;

  FOREACH wanted IN ARRAY ARRAY['suppressed_at', 'suppressed_by_window_id', 'unsuppressed_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'bms.alarms'::regclass AND attname = wanted AND NOT attisdropped AND NOT attnotnull
    ) THEN
      RAISE EXCEPTION 'migration 0152: bms.alarms.% is missing or NOT NULL', wanted;
    END IF;
  END LOOP;
END $$;
