-- E3.1 / ADR 0122 decisions 4 and 9 (migration C) - work-order checklists.
--
-- WHAT THIS FILE DOES
--   1. bms.work_order_checklist_templates and bms.work_order_checklist_template_items:
--      a reusable checklist, per organization and optionally per asset domain
--      (domain NULL fits every domain). Tenant tables under FORCE row security.
--   2. bms.work_order_tasks IS a ticket's checklist. It gains mandatory, result
--      (pending / done / not_applicable), note, completed_by and template_item_id.
--   3. The work_order_tasks policy from 0047 is re-created with the parent check
--      (ruling P9), and a composite foreign key says the same for every role.
--   4. bms.maintenance_task_templates gains checklist_template_id, so converting a due
--      schedule brings its checklist.
--
-- A TICKET'S CHECKLIST IS A FROZEN COPY (decision 4.3). Create copies the template's
-- items into work_order_tasks; nothing reads the template for an open ticket again.
-- template_item_id only remembers where a task came from, and it is ON DELETE SET NULL
-- because a template edit replaces its items (plan D7): the copied task must survive.
--
-- result IS A CLOSED VOCABULARY the API branches on (the resolve gate), hence a CHECK
-- (AGENTS.md 4.8). The three values are WORK_ORDER_TASK_RESULTS in packages/shared; a
-- test holds the two lists equal. The legacy status column stays and is no longer read
-- (plan D21); nothing ever wrote it but the seed's default.
--
-- THE TASKS POLICY CHECKED ONLY ITS OWN COLUMN (0047). That was enough while nothing
-- wrote the table through the tenant pool. This PR adds the first such writer, and
-- Postgres runs a foreign-key check with row security off, so without the EXISTS a
-- tenant could file a task under its own organization_id against another
-- organization's work order. Both halves, USING and WITH CHECK, with no NULL disjunct
-- (the 0050 / 0082 / 0123 / 0144 shape). The items policy checks its template the same
-- way.
--
-- AND COMPOSITE FOREIGN KEYS SAY THE SAME THING FOR EVERY ROLE (the ADR 0102 shape,
-- as 0144 did for events). bms_fleet has BYPASSRLS, so a policy does not bind it:
--   work_order_tasks (organization_id, work_order_id) -> work_orders (organization_id, id)
--   work_order_tasks (organization_id, template_item_id) -> template items (organization_id, id)
--   template items   (organization_id, template_id)   -> templates (organization_id, id)
--   maintenance_task_templates (organization_id, checklist_template_id) -> templates
-- The second and the last are MATCH SIMPLE: a NULL pointer is not checked, a set one
-- must name a row of the same organization. The second is ON DELETE SET NULL
-- (template_item_id): only the pointer is cleared, never organization_id (the column
-- list needs Postgres 15; compose and CI run 16). The work_orders pair's unique index
-- is 0144's. Existing task rows satisfy the first key: 0046 filled their organization_id
-- from their work order.
--
-- A TEMPLATE'S NAME IS UNIQUE IN ITS ORGANIZATION, case-insensitively, so a picker
-- never shows two templates a person cannot tell apart. A retired template keeps its
-- name; rename it to reuse the name.
--
-- THE BACKFILL RUNS AFTER RESET ROLE (plan D2). Inside SET ROLE bms_owner, FORCE row
-- security makes an UPDATE of a tenant table match zero rows and raise nothing. The
-- migrator's own role (bms_app, a superuser) bypasses it. Only a task that already
-- carries a completed_at is marked done; today no row does, because no code path ever
-- completed a task. It is guarded by result = 'pending', so a second run changes nothing.
--
-- WHY THIS FILE WRITES NO GRANT. 0041 sets ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner
-- IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet.
-- The two new tables are created as bms_owner inside the bracket, so both pool roles
-- get all four. bms_auth and bms_rollup get nothing.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent. No hypertable, no Timescale change.

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.work_order_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  name varchar(255) NOT NULL,
  domain varchar(64) REFERENCES bms.asset_domains(code),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES bms.users(id),
  updated_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_templates_organization_name_key
  ON bms.work_order_checklist_templates(organization_id, lower(name));

-- The target of the two composite foreign keys below. (organization_id, id) is unique
-- because id is; the index exists only so the pair can be referenced.
CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_templates_organization_id_id_key
  ON bms.work_order_checklist_templates(organization_id, id);

ALTER TABLE bms.work_order_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_checklist_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_checklist_templates;
CREATE POLICY tenant_isolation ON bms.work_order_checklist_templates
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
  );

CREATE TABLE IF NOT EXISTS bms.work_order_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  template_id uuid NOT NULL REFERENCES bms.work_order_checklist_templates(id),
  title varchar(255) NOT NULL,
  mandatory boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_order_checklist_template_items_template_organization_fkey
    FOREIGN KEY (organization_id, template_id) REFERENCES bms.work_order_checklist_templates(organization_id, id)
);

-- The target of the composite foreign key from bms.work_order_tasks below.
CREATE UNIQUE INDEX IF NOT EXISTS work_order_checklist_template_items_organization_id_id_key
  ON bms.work_order_checklist_template_items(organization_id, id);

CREATE INDEX IF NOT EXISTS work_order_checklist_template_items_template_idx
  ON bms.work_order_checklist_template_items(template_id, sort_order);

ALTER TABLE bms.work_order_checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_checklist_template_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_checklist_template_items;
CREATE POLICY tenant_isolation ON bms.work_order_checklist_template_items
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_order_checklist_templates t
             WHERE t.id = work_order_checklist_template_items.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_order_checklist_templates t
             WHERE t.id = work_order_checklist_template_items.template_id
               AND t.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

ALTER TABLE bms.work_order_tasks
  ADD COLUMN IF NOT EXISTS mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result varchar(16) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES bms.users(id),
  ADD COLUMN IF NOT EXISTS template_item_id uuid;

ALTER TABLE bms.work_order_tasks DROP CONSTRAINT IF EXISTS work_order_tasks_template_item_organization_fkey;
ALTER TABLE bms.work_order_tasks
  ADD CONSTRAINT work_order_tasks_template_item_organization_fkey
  FOREIGN KEY (organization_id, template_item_id) REFERENCES bms.work_order_checklist_template_items(organization_id, id)
  ON DELETE SET NULL (template_item_id);

ALTER TABLE bms.work_order_tasks DROP CONSTRAINT IF EXISTS work_order_tasks_result_check;
ALTER TABLE bms.work_order_tasks
  ADD CONSTRAINT work_order_tasks_result_check CHECK (result IN ('pending','done','not_applicable'));

ALTER TABLE bms.work_order_tasks DROP CONSTRAINT IF EXISTS work_order_tasks_work_order_organization_fkey;
ALTER TABLE bms.work_order_tasks
  ADD CONSTRAINT work_order_tasks_work_order_organization_fkey
  FOREIGN KEY (organization_id, work_order_id) REFERENCES bms.work_orders(organization_id, id);

-- ON DELETE SET NULL above scans this column when a template's items are replaced.
CREATE INDEX IF NOT EXISTS work_order_tasks_template_item_idx
  ON bms.work_order_tasks(template_item_id)
  WHERE template_item_id IS NOT NULL;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_tasks;
CREATE POLICY tenant_isolation ON bms.work_order_tasks
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_orders w
             WHERE w.id = work_order_tasks.work_order_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_orders w
             WHERE w.id = work_order_tasks.work_order_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

ALTER TABLE bms.maintenance_task_templates
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid;

ALTER TABLE bms.maintenance_task_templates
  DROP CONSTRAINT IF EXISTS maintenance_task_templates_checklist_template_organization_fkey;
ALTER TABLE bms.maintenance_task_templates
  ADD CONSTRAINT maintenance_task_templates_checklist_template_organization_fkey
  FOREIGN KEY (organization_id, checklist_template_id) REFERENCES bms.work_order_checklist_templates(organization_id, id);

RESET ROLE;

-- The backfill, as the migrator's superuser role (see the header). A role that row
-- security binds would mark nothing here, so the role is checked first, where the
-- failure can say what is wrong.
DO $$
BEGIN
  IF NOT (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) THEN
    RAISE EXCEPTION
      'migration 0145: the work_order_tasks backfill must run as a role that bypasses row security, not as %', current_user;
  END IF;
END
$$;

UPDATE bms.work_order_tasks
   SET result = 'done'
 WHERE completed_at IS NOT NULL
   AND result = 'pending';

-- The proof, as the migrator's own superuser role: a policy that is missing, row security
-- that is not forced, or a table created by the wrong role reads correct in this file and
-- guards nothing. The owner is read from pg_class: the pool roles' privileges alone do
-- not prove it, because 0039 grants them the same four on a table bms_app creates.
DO $$
DECLARE
  tbl text;
  priv text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['work_order_checklist_templates', 'work_order_checklist_template_items', 'work_order_tasks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = tbl
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'migration 0145: row level security is not enabled and forced on bms.%', tbl;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'bms' AND c.relname = tbl
         AND c.relowner = 'bms_owner'::regrole
    ) THEN
      RAISE EXCEPTION 'migration 0145: bms.% is not owned by bms_owner (was it created outside the SET ROLE bracket?)', tbl;
    END IF;

    -- One call per privilege: has_table_privilege with a comma list answers true when
    -- the role holds ANY ONE of them, which would prove nothing here.
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege('bms_tenant', 'bms.' || tbl, priv)
         OR NOT has_table_privilege('bms_fleet', 'bms.' || tbl, priv) THEN
        RAISE EXCEPTION 'migration 0145: a pool role lacks % on bms.%', priv, tbl;
      END IF;
    END LOOP;

    -- "bms_auth and bms_rollup get nothing" (the header), read back.
    IF has_table_privilege('bms_auth', 'bms.' || tbl, 'SELECT') OR has_table_privilege('bms_rollup', 'bms.' || tbl, 'SELECT') THEN
      RAISE EXCEPTION 'migration 0145: bms_auth or bms_rollup can read bms.%', tbl;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'bms' AND p.tablename = 'work_order_checklist_templates' AND p.policyname = 'tenant_isolation'
       AND p.qual LIKE '%app.current_organization%' AND p.with_check LIKE '%app.current_organization%'
  ) THEN
    RAISE EXCEPTION 'migration 0145: tenant_isolation must check the organization setting in USING and WITH CHECK on the templates table';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'bms' AND p.tablename = 'work_order_checklist_template_items' AND p.policyname = 'tenant_isolation'
       AND p.qual LIKE '%work_order_checklist_templates%' AND p.with_check LIKE '%work_order_checklist_templates%'
  ) THEN
    RAISE EXCEPTION 'migration 0145: the items policy must check the parent template in USING and WITH CHECK';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'bms' AND p.tablename = 'work_order_tasks' AND p.policyname = 'tenant_isolation'
       AND p.qual LIKE '%work_orders%' AND p.with_check LIKE '%work_orders%'
  ) THEN
    RAISE EXCEPTION 'migration 0145: the work_order_tasks policy must check the parent work order in USING and WITH CHECK (ruling P9)';
  END IF;

  -- Each composite key by name, by the table that holds it and by the table it points at.
  IF (SELECT count(*) FROM pg_constraint k
        JOIN pg_class c ON c.oid = k.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_class f ON f.oid = k.confrelid
       WHERE n.nspname = 'bms' AND k.contype = 'f' AND array_length(k.conkey, 1) = 2
         AND (c.relname, k.conname, f.relname) IN (
           ('work_order_checklist_template_items', 'work_order_checklist_template_items_template_organization_fkey', 'work_order_checklist_templates'),
           ('work_order_tasks', 'work_order_tasks_work_order_organization_fkey', 'work_orders'),
           ('work_order_tasks', 'work_order_tasks_template_item_organization_fkey', 'work_order_checklist_template_items'),
           ('maintenance_task_templates', 'maintenance_task_templates_checklist_template_organization_fkey', 'work_order_checklist_templates')
         )) <> 4 THEN
    RAISE EXCEPTION 'migration 0145: a composite organization foreign key is missing or points at the wrong table';
  END IF;

  -- A replaced template item must clear the task's pointer, and only the pointer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint k
     WHERE k.conname = 'work_order_tasks_template_item_organization_fkey'
       AND k.conrelid = 'bms.work_order_tasks'::regclass
       AND k.confdeltype = 'n' AND array_length(k.confdelsetcols, 1) = 1
  ) THEN
    RAISE EXCEPTION 'migration 0145: the template_item_id key must be ON DELETE SET NULL (template_item_id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms' AND c.relname = 'work_order_tasks'
       AND k.conname = 'work_order_tasks_result_check' AND k.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'migration 0145: the result CHECK is missing on bms.work_order_tasks';
  END IF;

  IF EXISTS (SELECT 1 FROM bms.work_order_tasks WHERE completed_at IS NOT NULL AND result = 'pending') THEN
    RAISE EXCEPTION 'migration 0145: a completed task still reads pending after the backfill (was it run under SET ROLE?)';
  END IF;
END
$$;
