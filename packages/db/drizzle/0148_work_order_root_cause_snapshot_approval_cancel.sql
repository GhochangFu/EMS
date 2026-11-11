-- E3.1 / ADR 0122 decisions 5, 5a, 6 and 9 (migration D) - root cause, the alarm
-- snapshot (E3.4), and the columns of closure approval and cancel.
--
-- WHAT THIS FILE DOES
--   1. bms.work_order_cause_codes: a global vocabulary of coded causes, seeded with the
--      nine codes of ruling P5.
--   2. bms.work_orders gains thirteen nullable columns:
--        the technician's findings   root_cause, corrective_action, preventive_action,
--                                    cause_code
--        the alarm snapshot (E3.4)   alarm_root_cause, alarm_corrective_actions,
--                                    alarm_skill_code, alarm_etr_at
--        who resolved it             resolved_by
--        approval and cancel         approved_by, approved_at, cancelled_by, cancelled_at
--   3. A CHECK on bms.work_orders.status naming the six values.
--
-- THIS IS MIGRATION D WHOLE (plan D15), so the ADR's "four migrations" holds. The
-- approval and cancel columns and the 'cancelled' status have no writer until the next
-- PR; the findings, the snapshot and resolved_by are written from this one.
--
-- work_order_cause_codes IS PLATFORM VOCABULARY (ADR 0031 / 0034 shape; AGENTS.md 4.4,
-- ruled by accepting ADR 0122 decision 5.1): data, not an enum, retired with
-- active = false, never deleted. It holds no tenant data, so it has no organization_id,
-- no policy and no FORCE. Its grants are therefore its only containment. Every signed-in
-- user reads it through the tenant pool, and no API path writes it, so INSERT, UPDATE
-- and DELETE are revoked from bms_tenant (the 0059 / 0085 / 0090 shape): a tenant-pool
-- write would otherwise retire a code for the whole fleet. bms_fleet keeps all four,
-- as on the other vocabularies; nothing writes it there today.
--
-- status IS A CLOSED VOCABULARY the API branches on, hence a CHECK (AGENTS.md 4.8). The
-- six values are workOrderStatusSchema plus 'cancelled', which that schema gains in the
-- next PR. Until now the column took any string. An existing row with another value
-- would fail the ALTER with a constraint error that names no row, so a DO block looks
-- first and names the value. It runs OUTSIDE the role bracket: under SET ROLE bms_owner,
-- FORCE row security hides every work order and the look would pass on a table it
-- cannot see.
--
-- NOTHING IS BACKFILLED. A ticket older than this file has NULL findings, a NULL
-- snapshot (decision 5a.4) and a NULL resolved_by; an existing closed row stays closed
-- with approved_by NULL (decision 6.7).
--
-- cause_code and alarm_skill_code carry a foreign key and no ON DELETE clause: a code
-- and a skill are retired, not deleted, and a ticket keeps the one it was given.
--
-- WHY THIS FILE WRITES NO GRANT. 0041 sets ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner
-- IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet.
-- The table is created as bms_owner inside the bracket, so both pool roles get all four,
-- and the REVOKE below takes three back from bms_tenant.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent. No hypertable, no Timescale change.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.work_order_cause_codes (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bms.work_order_cause_codes (code, label, sort_order) VALUES
  ('equipment_failure', 'Equipment failure', 10),
  ('wear_and_tear', 'Wear and tear', 20),
  ('power_quality', 'Power quality', 30),
  ('sensor_fault', 'Sensor fault', 40),
  ('configuration_error', 'Configuration error', 50),
  ('operator_error', 'Operator error', 60),
  ('external_event', 'External event', 70),
  ('no_fault_found', 'No fault found', 80),
  ('other', 'Other', 90)
ON CONFLICT (code) DO NOTHING;

REVOKE INSERT, UPDATE, DELETE ON bms.work_order_cause_codes FROM bms_tenant;

ALTER TABLE bms.work_orders
  ADD COLUMN IF NOT EXISTS root_cause text,
  ADD COLUMN IF NOT EXISTS corrective_action text,
  ADD COLUMN IF NOT EXISTS preventive_action text,
  ADD COLUMN IF NOT EXISTS cause_code varchar(64) REFERENCES bms.work_order_cause_codes(code),
  ADD COLUMN IF NOT EXISTS alarm_root_cause text,
  ADD COLUMN IF NOT EXISTS alarm_corrective_actions text,
  ADD COLUMN IF NOT EXISTS alarm_skill_code varchar(64) REFERENCES bms.alarm_skills(code),
  ADD COLUMN IF NOT EXISTS alarm_etr_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES bms.users(id),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES bms.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES bms.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

RESET ROLE;

-- The look before the CHECK, as the migrator's superuser role (see the header). A role
-- that row security binds would see no work order here, so the role is checked first.
DO $$
DECLARE
  bad text;
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION
      'migration 0148: the work_orders status check must run as a role that bypasses row security, not as %', current_user;
  END IF;

  SELECT string_agg(DISTINCT quote_literal(w.status), ', ') INTO bad
    FROM bms.work_orders w
   WHERE w.status NOT IN ('open','assigned','in_progress','resolved','closed','cancelled');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 0148: bms.work_orders holds a status outside the vocabulary: %. Correct those rows, then run the migration again.', bad;
  END IF;
END
$$;

SET ROLE bms_owner;

ALTER TABLE bms.work_orders DROP CONSTRAINT IF EXISTS work_orders_status_check;
ALTER TABLE bms.work_orders
  ADD CONSTRAINT work_orders_status_check CHECK (status IN ('open','assigned','in_progress','resolved','closed','cancelled'));

RESET ROLE;

-- The proof, as the migrator's own superuser role.
DO $$
DECLARE
  priv text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms' AND c.relname = 'work_order_cause_codes'
       AND c.relowner = 'bms_owner'::regrole
       AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'migration 0148: bms.work_order_cause_codes must be owned by bms_owner and carry no row security';
  END IF;

  -- One call per privilege: has_table_privilege with a comma list answers true when the
  -- role holds ANY ONE of them, which would prove nothing here.
  IF NOT has_table_privilege('bms_tenant', 'bms.work_order_cause_codes', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0148: bms_tenant cannot read bms.work_order_cause_codes';
  END IF;
  FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('bms_tenant', 'bms.work_order_cause_codes', priv) THEN
      RAISE EXCEPTION 'migration 0148: bms_tenant can still % bms.work_order_cause_codes; the vocabulary is read-only there', priv;
    END IF;
  END LOOP;
  IF has_table_privilege('bms_auth', 'bms.work_order_cause_codes', 'SELECT')
     OR has_table_privilege('bms_rollup', 'bms.work_order_cause_codes', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0148: bms_auth or bms_rollup can read bms.work_order_cause_codes';
  END IF;

  IF (SELECT count(*) FROM bms.work_order_cause_codes
       WHERE code = ANY (ARRAY['equipment_failure', 'wear_and_tear', 'power_quality', 'sensor_fault', 'configuration_error',
                               'operator_error', 'external_event', 'no_fault_found', 'other'])) <> 9 THEN
    RAISE EXCEPTION 'migration 0148: the nine cause codes of ruling P5 are not all present';
  END IF;

  IF (SELECT count(*) FROM pg_attribute a
       WHERE a.attrelid = 'bms.work_orders'::regclass AND NOT a.attisdropped AND NOT a.attnotnull
         AND a.attname IN ('root_cause', 'corrective_action', 'preventive_action', 'cause_code',
                           'alarm_root_cause', 'alarm_corrective_actions', 'alarm_skill_code', 'alarm_etr_at',
                           'resolved_by', 'approved_by', 'approved_at', 'cancelled_by', 'cancelled_at')) <> 13 THEN
    RAISE EXCEPTION 'migration 0148: bms.work_orders must carry the thirteen new columns, all nullable';
  END IF;

  IF (SELECT count(*) FROM pg_constraint k
        JOIN pg_class f ON f.oid = k.confrelid
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
       WHERE k.conrelid = 'bms.work_orders'::regclass AND k.contype = 'f' AND array_length(k.conkey, 1) = 1
         AND (a.attname, f.relname) IN (('cause_code', 'work_order_cause_codes'), ('alarm_skill_code', 'alarm_skills'))) <> 2 THEN
    RAISE EXCEPTION 'migration 0148: cause_code and alarm_skill_code must each carry their foreign key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint k
     WHERE k.conrelid = 'bms.work_orders'::regclass
       AND k.conname = 'work_orders_status_check' AND k.contype = 'c'
       AND (SELECT bool_and(position(quote_literal(v) IN pg_get_constraintdef(k.oid)) > 0)
              FROM unnest(ARRAY['open', 'assigned', 'in_progress', 'resolved', 'closed', 'cancelled']) AS v)
  ) THEN
    RAISE EXCEPTION 'migration 0148: the six-value status CHECK is missing on bms.work_orders';
  END IF;
END
$$;
