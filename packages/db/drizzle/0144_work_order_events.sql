-- E3.1 / ADR 0122 decisions 7 and 9 (migration B) - bms.work_order_events, the timeline
-- of a work order: one row per thing that happened to it.
--
-- TWO HISTORIES, ONE TRANSACTION. Every work-order write inserts its event here in the
-- same transaction as the change, and still writes its bms.audit_log row. This table is
-- the product history any reader of the ticket may see; audit_log stays the compliance
-- record behind its own gate (ADR 0021 / 0046).
--
-- APPEND-ONLY BY PRIVILEGE (decision 7.2). UPDATE and DELETE are revoked from bms_tenant
-- and bms_fleet, the only two roles the API connects as, so no API code path can change
-- or remove an event. It is NOT tamper-evident: bms_owner and the migrator can still
-- write, and nothing chains the rows. Hash-chaining stays with F4.15.
--
-- actor_name IS SAVED, NOT JOINED (ruling P7). It is the actor's display name at the
-- time of the event. A tenant reader cannot read a global admin's bms.users row, and a
-- later rename must not rewrite history. It is a display name only: this table has no
-- email and no subject column, and detail is a closed JSON shape the API builds
-- (workOrderEventDetailSchema), so neither can enter by another door.
--
-- event_type is a closed vocabulary the API branches on, hence a CHECK (AGENTS.md 4.8).
-- The ten values are WORK_ORDER_EVENT_TYPES in packages/shared; a test holds the two
-- lists equal. sla_changed is reserved and has no writer yet.
--
-- NO HISTORY IS INVENTED (ruling P10): this file inserts no event. A ticket older than
-- this table has an empty timeline, and its stepper reads its status.
--
-- created_at DEFAULTS TO clock_timestamp(), NOT now(). now() is the transaction's start
-- time, so two events written by one write (an assign and a status move, say) would
-- share a timestamp and the timeline would order them by their random ids. The wall
-- clock at insert keeps them in the order they were written.
--
-- work_order_id carries no ON DELETE clause: a work order is never deleted by the
-- product, and an event must not vanish with one by accident.
--
-- THE POLICY CHECKS ITS ORG-BEARING PARENT, NOT ONLY ITS OWN COLUMN (the 0050 / 0082 /
-- 0123 shape). Postgres runs a foreign-key check with row security off, so without the
-- EXISTS a tenant could file an event under its own organization_id against another
-- organization's work order. Both halves, USING and WITH CHECK, with no NULL disjunct.
--
-- AND A COMPOSITE FOREIGN KEY SAYS THE SAME THING FOR EVERY ROLE (the ADR 0102 shape).
-- bms_fleet has BYPASSRLS, so the policy does not bind it: a fleet-pool insert could file
-- an event under organization A against organization B's work order, and B's readers
-- would see it. FOREIGN KEY (organization_id, work_order_id) REFERENCES
-- work_orders(organization_id, id) makes that impossible for any role. No writer uses
-- the fleet pool today; the key keeps it true when one does.
--
-- WHY THIS FILE WRITES NO GRANT. 0041 sets ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner
-- IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet.
-- The table is created as bms_owner inside the bracket, so both pool roles get all four,
-- and the REVOKE below takes two back.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app), hence the bracket.
-- Forward-only and idempotent.

SET ROLE bms_owner;

-- The target of the composite foreign key below. (organization_id, id) is unique because
-- id is; the index exists only so the pair can be referenced.
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_organization_id_id_key
  ON bms.work_orders(organization_id, id);

CREATE TABLE IF NOT EXISTS bms.work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES bms.organizations(id),
  work_order_id uuid NOT NULL REFERENCES bms.work_orders(id),
  event_type varchar(32) NOT NULL,
  actor_id uuid REFERENCES bms.users(id),
  actor_name varchar(255),
  from_status varchar(32),
  to_status varchar(32),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_order_events_work_order_organization_fkey
    FOREIGN KEY (organization_id, work_order_id) REFERENCES bms.work_orders(organization_id, id),
  CONSTRAINT work_order_events_event_type_check CHECK (event_type IN ('created','assigned','status_changed','task_updated','root_cause_set','resolved','approved','rejected','cancelled','sla_changed'))
);

CREATE INDEX IF NOT EXISTS work_order_events_work_order_created_idx
  ON bms.work_order_events(work_order_id, created_at);

ALTER TABLE bms.work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_events;
CREATE POLICY tenant_isolation ON bms.work_order_events
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_orders w
             WHERE w.id = work_order_events.work_order_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.work_orders w
             WHERE w.id = work_order_events.work_order_id
               AND w.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

REVOKE UPDATE, DELETE ON bms.work_order_events FROM bms_tenant, bms_fleet;

RESET ROLE;

-- The proof, as the migrator's own superuser role. One call per privilege:
-- has_table_privilege with a comma list answers true when the role holds ANY ONE.
DO $$
DECLARE
  pool_role text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms' AND c.relname = 'work_order_events'
       AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'migration 0144: row level security is not enabled and forced on bms.work_order_events';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname = 'bms' AND p.tablename = 'work_order_events' AND p.policyname = 'tenant_isolation'
       AND p.qual LIKE '%work_orders%' AND p.with_check LIKE '%work_orders%'
  ) THEN
    RAISE EXCEPTION 'migration 0144: tenant_isolation must check the parent work order in USING and WITH CHECK';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'bms' AND c.relname = 'work_order_events'
       AND k.conname = 'work_order_events_work_order_organization_fkey' AND k.contype = 'f'
       AND array_length(k.conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'migration 0144: the composite (organization_id, work_order_id) foreign key is missing';
  END IF;

  FOREACH pool_role IN ARRAY ARRAY['bms_tenant', 'bms_fleet'] LOOP
    IF NOT has_table_privilege(pool_role, 'bms.work_order_events', 'SELECT') THEN
      RAISE EXCEPTION 'migration 0144: % cannot SELECT bms.work_order_events (was it created as bms_owner?)', pool_role;
    END IF;
    IF NOT has_table_privilege(pool_role, 'bms.work_order_events', 'INSERT') THEN
      RAISE EXCEPTION 'migration 0144: % lacks INSERT on the events table (was it created as bms_owner?)', pool_role;
    END IF;
    IF has_table_privilege(pool_role, 'bms.work_order_events', 'UPDATE') THEN
      RAISE EXCEPTION 'migration 0144: % can still UPDATE bms.work_order_events; the timeline must be append-only', pool_role;
    END IF;
    IF has_table_privilege(pool_role, 'bms.work_order_events', 'DELETE') THEN
      RAISE EXCEPTION 'migration 0144: % can still DELETE from bms.work_order_events; the timeline must be append-only', pool_role;
    END IF;
  END LOOP;
END
$$;
