-- E3.1 / ADR 0122 decisions 2, 3 and 9 (migration A) - work-order references and SLA.
--
-- WHAT IT ADDS
--   bms.work_orders        + seq, reference (decision 2), sla_minutes, sla_due_at (decision 3)
--   bms.asset_domains      + work_order_prefix (decision 2.4), filled for the eight known domains
--   bms.asset_templates    + work_order_prefix (decision 2.5, ruling Q4: a template may override)
--   bms.work_order_counters      one row per organization, the next seq to hand out
--   bms.work_order_sla_policies  one row per (organization, priority), minutes to resolved
--
-- THE REFERENCE is <PREFIX>-<seq>, seq zero-padded to at least six digits. It is written
-- once at create and never changes. lpad(seq, 6) alone would TRUNCATE at seq 1,000,000
-- and collide with seq 100,000, hence greatest(6, length(seq)).
--
-- THE BACKFILL RUNS AFTER RESET ROLE, ON PURPOSE. bms.work_orders is under FORCE ROW
-- LEVEL SECURITY (0047), and FORCE binds the table owner too. Inside SET ROLE bms_owner,
-- with no app.current_organization set, an UPDATE of bms.work_orders matches zero rows
-- and raises nothing (AGENTS.md 4.4). The migrator's own role (bms_app) is a superuser
-- and bypasses row security, so the two backfill statements sit between the brackets.
-- A DO block then raises if any row still has no seq, BEFORE the SET NOT NULL.
--
-- Existing rows are numbered per organization in created_at, id order, continuing after
-- that organization's highest seq, and take the prefix of their asset's current DOMAIN,
-- or GEN (decision 2.6). The template prefix applies to new tickets only. A row that
-- already has a seq is left alone, so a second run changes nothing.
--
-- seq AND reference BECOME NOT NULL HERE. Every writer of bms.work_orders must set both
-- from this migration on: the API takes them from allocateWorkOrderReference
-- (packages/db/src/work-order-reference.ts).
--
-- EVERY POLICY CHECKS ITS OWN organization_id in USING and WITH CHECK, with no NULL
-- disjunct. Both new tables hang directly off bms.organizations, so there is no further
-- org-bearing parent to check (the 0050 / 0082 EXISTS shape applies to a child table).
--
-- WHY THIS FILE WRITES NO GRANT. 0041_bms_owner_and_force_rls.sql sets ALTER DEFAULT
-- PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON
-- TABLES TO bms_tenant, bms_fleet. Default privileges fire only for objects created by
-- the role they name, so the tables are created inside SET ROLE / RESET ROLE.
-- bms.asset_domains and bms.asset_templates keep the privileges they have.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the brackets.
-- Forward-only and idempotent: IF NOT EXISTS, DROP ... IF EXISTS before each ADD
-- CONSTRAINT and CREATE POLICY, and guarded data statements.

SET ROLE bms_owner;

ALTER TABLE bms.work_orders
  ADD COLUMN IF NOT EXISTS seq integer,
  ADD COLUMN IF NOT EXISTS reference varchar(32),
  ADD COLUMN IF NOT EXISTS sla_minutes integer,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz;

ALTER TABLE bms.work_orders DROP CONSTRAINT IF EXISTS work_orders_sla_minutes_check;
ALTER TABLE bms.work_orders
  ADD CONSTRAINT work_orders_sla_minutes_check CHECK (sla_minutes IS NULL OR sla_minutes BETWEEN 1 AND 525600);

ALTER TABLE bms.work_orders DROP CONSTRAINT IF EXISTS work_orders_sla_pair_check;
ALTER TABLE bms.work_orders
  ADD CONSTRAINT work_orders_sla_pair_check CHECK ((sla_minutes IS NULL) = (sla_due_at IS NULL));

ALTER TABLE bms.work_orders DROP CONSTRAINT IF EXISTS work_orders_seq_check;
ALTER TABLE bms.work_orders
  ADD CONSTRAINT work_orders_seq_check CHECK (seq >= 1);

ALTER TABLE bms.asset_domains
  ADD COLUMN IF NOT EXISTS work_order_prefix varchar(8);

ALTER TABLE bms.asset_domains DROP CONSTRAINT IF EXISTS asset_domains_work_order_prefix_check;
ALTER TABLE bms.asset_domains
  ADD CONSTRAINT asset_domains_work_order_prefix_check CHECK (work_order_prefix ~ '^[A-Z0-9]{2,8}$');

ALTER TABLE bms.asset_templates
  ADD COLUMN IF NOT EXISTS work_order_prefix varchar(8);

ALTER TABLE bms.asset_templates DROP CONSTRAINT IF EXISTS asset_templates_work_order_prefix_check;
ALTER TABLE bms.asset_templates
  ADD CONSTRAINT asset_templates_work_order_prefix_check CHECK (work_order_prefix ~ '^[A-Z0-9]{2,8}$');

-- bms.asset_domains carries no row security, so this runs correctly as bms_owner.
-- mechanical, facility and ups are written by the seed, not by a migration: on a fresh
-- database they do not exist yet and the seed sets their prefix (asset-domains-seed.ts).
UPDATE bms.asset_domains d
   SET work_order_prefix = v.prefix
  FROM (VALUES
    ('electrical', 'ELEC'),
    ('hvac', 'HVAC'),
    ('it', 'IT'),
    ('environment', 'ENV'),
    ('water', 'WATER'),
    ('mechanical', 'MECH'),
    ('ups', 'UPS'),
    ('facility', 'FAC')
  ) AS v(code, prefix)
 WHERE d.code = v.code
   AND d.work_order_prefix IS NULL;

CREATE TABLE IF NOT EXISTS bms.work_order_counters (
  organization_id uuid PRIMARY KEY REFERENCES bms.organizations(id),
  next_seq integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_order_counters_next_seq_check CHECK (next_seq >= 1)
);

ALTER TABLE bms.work_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_counters;
CREATE POLICY tenant_isolation ON bms.work_order_counters
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS bms.work_order_sla_policies (
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  priority varchar(32) NOT NULL,
  resolution_minutes integer NOT NULL,
  updated_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, priority),
  CONSTRAINT work_order_sla_policies_priority_check CHECK (priority IN ('low','medium','high','critical')),
  CONSTRAINT work_order_sla_policies_minutes_check CHECK (resolution_minutes BETWEEN 1 AND 525600)
);

ALTER TABLE bms.work_order_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_sla_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_sla_policies;
CREATE POLICY tenant_isolation ON bms.work_order_sla_policies
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

RESET ROLE;

-- The backfill, as the migrator's superuser role (see the header). A role that row
-- security binds would number nothing here AND see nothing in the guard below, so the
-- role is checked first, where the failure can say what is wrong.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION
      'migration 0140: the work_orders backfill must run as a role that bypasses row security, not as %', current_user;
  END IF;
END
$$;

UPDATE bms.work_orders w
   SET seq = r.seq,
       reference = coalesce(d.work_order_prefix, 'GEN') || '-' || lpad(r.seq::text, greatest(6, length(r.seq::text)), '0')
  FROM (
    SELECT w.id,
           (row_number() OVER (PARTITION BY w.organization_id ORDER BY w.created_at, w.id)
             + coalesce((SELECT max(x.seq) FROM bms.work_orders x WHERE x.organization_id = w.organization_id), 0))::integer AS seq
      FROM bms.work_orders w
     WHERE w.seq IS NULL
  ) r
  JOIN bms.work_orders src ON src.id = r.id
  JOIN bms.assets a ON a.id = src.asset_id
  LEFT JOIN bms.asset_domains d ON d.code = a.domain
 WHERE w.id = r.id
   AND w.seq IS NULL;

INSERT INTO bms.work_order_counters (organization_id, next_seq)
SELECT w.organization_id, max(w.seq) + 1
  FROM bms.work_orders w
 GROUP BY w.organization_id
ON CONFLICT (organization_id) DO UPDATE
   SET next_seq = greatest(bms.work_order_counters.next_seq, excluded.next_seq),
       updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bms.work_orders WHERE seq IS NULL OR reference IS NULL) THEN
    RAISE EXCEPTION
      'migration 0140: a work order still has no seq or reference after the backfill (was it run under SET ROLE?)';
  END IF;
END
$$;

SET ROLE bms_owner;

ALTER TABLE bms.work_orders
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN reference SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_seq_key
  ON bms.work_orders(organization_id, seq);

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_reference_key
  ON bms.work_orders(organization_id, reference);

RESET ROLE;

-- The proof, as the migrator's own superuser role: a policy that is missing, row security
-- that is not forced, or a column left nullable reads correct in this file and guards
-- nothing.
DO $$
DECLARE
  tbl text;
  priv text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['work_order_counters', 'work_order_sla_policies'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = tbl
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0140: row level security is not enabled and forced on bms.%', tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'bms' AND p.tablename = tbl AND p.policyname = 'tenant_isolation'
         AND p.qual IS NOT NULL AND p.with_check IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'migration 0140: tenant_isolation with USING and WITH CHECK is missing on bms.%', tbl;
    END IF;

    -- One call per privilege: has_table_privilege with a comma list answers true when
    -- the role holds ANY ONE of them, which would prove nothing here.
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('bms_tenant', 'bms.' || tbl, priv)
         OR NOT has_table_privilege('bms_fleet', 'bms.' || tbl, priv) THEN
        RAISE EXCEPTION 'migration 0140: bms.% was not created as bms_owner (a pool role lacks %)', tbl, priv;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH tbl IN ARRAY ARRAY['asset_domains', 'asset_templates'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = tbl
         AND k.conname = tbl || '_work_order_prefix_check' AND k.contype = 'c'
    ) THEN
      RAISE EXCEPTION 'migration 0140: the work_order_prefix CHECK is missing on bms.%', tbl;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = 'work_orders'
         AND a.attname IN ('seq', 'reference') AND a.attnotnull) <> 2 THEN
    RAISE EXCEPTION 'migration 0140: bms.work_orders.seq and reference must both be NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM bms.work_orders w
      JOIN bms.work_order_counters k ON k.organization_id = w.organization_id
     GROUP BY k.organization_id, k.next_seq
    HAVING k.next_seq <= max(w.seq)
  ) OR EXISTS (
    SELECT 1 FROM bms.work_orders w
     WHERE NOT EXISTS (SELECT 1 FROM bms.work_order_counters k WHERE k.organization_id = w.organization_id)
  ) THEN
    RAISE EXCEPTION 'migration 0140: an organization''s counter is missing or not past its highest seq';
  END IF;
END
$$;
