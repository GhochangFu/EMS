-- E7.1b / ADR 0043 decision 5 (+ Amendment 4), decisions 6, 10 and 11.
--
-- The ENFORCEMENT half of the tenant boundary. `0046` added a nullable
-- `organization_id` to the 19 tenant-bearing tables and backfilled it from the
-- FK graph; the write path (E7.1b Task 2) now stamps it on every insert. This
-- migration makes the column mandatory where it must be, gives every tenant
-- table and its junctions a `tenant_isolation` policy, and turns on
-- `FORCE ROW LEVEL SECURITY` so the boundary binds `bms_owner` too — not only
-- the pool roles. It also discharges Amendment 4: `bms.users` now carries the
-- home org, so `bms_auth` no longer walks `locations`/`user_organization_access`
-- and those grants and their bootstrap policies come off.
--
-- Counts. This migration touches 15 + 4 + 3 = 22 tables. Earlier planning prose
-- said "12"/"14"; those numbers predate the Task 0 audit that ruled in the five
-- extra tenant tables (`rtu_connection_configs`, `alarm_enrichments`,
-- `work_order_tasks`, `maintenance_task_templates`, `template_points`) on
-- decision 5's "at minimum". `0046`'s own abort step is the authority: it names
-- exactly the 15 tables that get `SET NOT NULL` here, and 19 tenant tables − 4
-- nullable-by-design = 15. `tests/adr-0043-tenant-columns.test.ts` pins the set.
--
-- The four nullable-by-design tables (`audit_log`, `users`,
-- `notification_channels`, `notification_deliveries`) keep a nullable column and
-- get a NULL-tolerant policy (decisions 5/7 + Amendment 4): a global `admin`
-- user is org-less, and every E7.1b `audit_log`/channel/delivery row is written
-- org-less this item (population is E7.1c).
--
-- Runs under `SET ROLE bms_owner` (ADR 0045): the owner can ALTER/CREATE POLICY
-- on the tables it owns, and no statement needs SUPERUSER. Forward-only and
-- idempotent (AGENTS.md §4): `SET NOT NULL` re-run is a no-op, `ENABLE`/`FORCE`
-- re-asserted is a no-op, and every policy is `DROP POLICY IF EXISTS` then
-- `CREATE`. `0039`–`0046` are untouched — drizzle keys its journal by file hash.

SET ROLE bms_owner;

-- 1. SET NOT NULL on the 15 tables `0046`'s abort proved fully resolvable.
--
-- DDL, so its validating table scan is NOT filtered by row-level security — it
-- sees every row regardless of `FORCE` or any GUC, so no per-organization loop
-- is needed (unlike `0046`'s DML backfill). Done FIRST, before any policy or
-- FORCE, so a row the write path failed to stamp aborts here as a clean
-- "column contains null values" rather than entangled in a half-enabled policy
-- state. The four nullable-by-design tables are deliberately absent.
ALTER TABLE bms.rtus                       ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.assets                     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.asset_groups               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.asset_points               ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.alarms                     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.automation_rules           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.rule_executions            ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.work_orders                ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.maintenance_schedules      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.maintenance_history        ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.rtu_connection_configs     ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.alarm_enrichments          ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.work_order_tasks           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.maintenance_task_templates ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bms.template_points            ALTER COLUMN organization_id SET NOT NULL;

-- 2. ENABLE ROW LEVEL SECURITY on all 19 tenant tables + the 3 junctions.
--
-- A policy has no effect until RLS is enabled, and FORCE requires it. The five
-- F4.16 tables (`locations`, `user_organization_access`, `point_keys`,
-- `asset_templates`, `onboarding_sessions`) already carry ENABLE + a policy
-- (0040) and FORCE (0041) and are not re-touched here.
ALTER TABLE bms.users                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rtus                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.assets                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_groups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_points                ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarms                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.automation_rules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rule_executions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_channels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_schedules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.audit_log                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rtu_connection_configs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_enrichments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_task_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.template_points             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_group_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.rule_notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_affected_assets       ENABLE ROW LEVEL SECURITY;

-- 3a. Standard tenant_isolation on the 15 NOT-NULL tables.
--
-- Exactly 0040's idiom: `current_setting(..., true)` returns NULL (not an error)
-- when the GUC is unset, so a connection with no tenant fails closed and quiet —
-- a missing SET LOCAL is an empty result in a test, not a 500 in production.
-- USING = WITH CHECK: a row is visible iff it belongs to the current org, and a
-- write is refused unless it names the current org.
DROP POLICY IF EXISTS tenant_isolation ON bms.rtus;
CREATE POLICY tenant_isolation ON bms.rtus
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.assets;
CREATE POLICY tenant_isolation ON bms.assets
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.asset_groups;
CREATE POLICY tenant_isolation ON bms.asset_groups
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.asset_points;
CREATE POLICY tenant_isolation ON bms.asset_points
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.alarms;
CREATE POLICY tenant_isolation ON bms.alarms
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.automation_rules;
CREATE POLICY tenant_isolation ON bms.automation_rules
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.rule_executions;
CREATE POLICY tenant_isolation ON bms.rule_executions
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.work_orders;
CREATE POLICY tenant_isolation ON bms.work_orders
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.maintenance_schedules;
CREATE POLICY tenant_isolation ON bms.maintenance_schedules
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.maintenance_history;
CREATE POLICY tenant_isolation ON bms.maintenance_history
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.rtu_connection_configs;
CREATE POLICY tenant_isolation ON bms.rtu_connection_configs
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_enrichments;
CREATE POLICY tenant_isolation ON bms.alarm_enrichments
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.work_order_tasks;
CREATE POLICY tenant_isolation ON bms.work_order_tasks
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.maintenance_task_templates;
CREATE POLICY tenant_isolation ON bms.maintenance_task_templates
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.template_points;
CREATE POLICY tenant_isolation ON bms.template_points
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- 3b. NULL-tolerant tenant_isolation on the 4 nullable-by-design tables.
--
-- USING is the SAME strict predicate as 3a: a NULL-org row is invisible to any
-- single-tenant GUC (`NULL = <org>` is never true), so it never leaks to a
-- tenant and is reachable only through `fleetDb` (BYPASSRLS). But WITH CHECK
-- also admits `organization_id IS NULL`, so an org-less insert is not rejected:
-- a global `admin` `users` row, and every E7.1b `audit_log`/channel/delivery
-- row (org population is E7.1c). The `IS NULL` disjunct must hold regardless of
-- the GUC — the audit write lands both inside a tenant transaction
-- (`app.current_organization` set) and outside one (unset) across the Task 2
-- sweep, and both write `organization_id = NULL`; a WITH CHECK that only
-- tolerated one case would break the other.
DROP POLICY IF EXISTS tenant_isolation ON bms.users;
CREATE POLICY tenant_isolation ON bms.users
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.audit_log;
CREATE POLICY tenant_isolation ON bms.audit_log
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.notification_channels;
CREATE POLICY tenant_isolation ON bms.notification_channels
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.notification_deliveries;
CREATE POLICY tenant_isolation ON bms.notification_deliveries
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id IS NULL
              OR organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

-- 3c. Junction policies — no column of their own; each keys on its parent's org.
--
-- A junction row is visible/insertable iff its org-bearing parent(s) belong to
-- the current org. The comparison is written explicitly (`parent.organization_id
-- = <current org>`) rather than leaning only on the parent's own policy to
-- filter the subquery, so it is correct under `bms_owner` (FORCE-bound but not
-- the same filtering as a tenant) as well as `bms_tenant`.
--
-- Two of the three junctions have TWO org-bearing parents; the policy checks
-- BOTH (a strict AND), which is tighter than keying on one and leaving a
-- cross-org pairing visible — not reachable through E7.1b's write paths, but a
-- stated choice, not an accident:
--   - asset_group_members  → asset_groups (asset_group_id) AND assets (asset_id)
--   - alarm_affected_assets → alarm_enrichments (enrichment_id) AND assets (asset_id)
-- `rule_notifications` keys on `automation_rules` (rule_id) ALONE, deliberately:
-- its other parent `notification_channels` carries a NULLABLE org, so it is not
-- a reliable isolation key (decision 5 / the plan's explicit instruction).
DROP POLICY IF EXISTS tenant_isolation ON bms.asset_group_members;
CREATE POLICY tenant_isolation ON bms.asset_group_members
  USING (
    EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = asset_group_members.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = asset_group_members.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.asset_groups g
             WHERE g.id = asset_group_members.asset_group_id
               AND g.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = asset_group_members.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_affected_assets;
CREATE POLICY tenant_isolation ON bms.alarm_affected_assets
  USING (
    EXISTS (SELECT 1 FROM bms.alarm_enrichments e
             WHERE e.id = alarm_affected_assets.enrichment_id
               AND e.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = alarm_affected_assets.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.alarm_enrichments e
             WHERE e.id = alarm_affected_assets.enrichment_id
               AND e.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM bms.assets a
             WHERE a.id = alarm_affected_assets.asset_id
               AND a.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.rule_notifications;
CREATE POLICY tenant_isolation ON bms.rule_notifications
  USING (
    EXISTS (SELECT 1 FROM bms.automation_rules r
             WHERE r.id = rule_notifications.rule_id
               AND r.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.automation_rules r
             WHERE r.id = rule_notifications.rule_id
               AND r.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

-- 4. FORCE ROW LEVEL SECURITY on the full set.
--
-- ENABLE exempts the table owner; FORCE does not (ADR 0043 decision 12). Without
-- it `bms_owner` — the API's `DATABASE_URL` role since E7.1a, and the seed's
-- role — would bypass every policy above. `bms_fleet`'s BYPASSRLS is a role
-- attribute FORCE does not restrain, which is what keeps the fleet read path
-- whole.
ALTER TABLE bms.users                       FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.rtus                        FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.assets                      FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_groups                FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_points                FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarms                      FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.automation_rules            FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.rule_executions             FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_channels       FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.notification_deliveries     FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.work_orders                 FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_schedules       FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_history         FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.audit_log                   FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.rtu_connection_configs      FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_enrichments           FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.work_order_tasks            FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.maintenance_task_templates  FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.template_points             FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.asset_group_members         FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.rule_notifications          FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_affected_assets       FORCE ROW LEVEL SECURITY;

-- 5. Amendment 4 — the auth-pool swap now that bms.users carries the home org.
--
-- 5a. bms_auth reads and writes bms.users pre-authentication, before any tenant
-- is set, so it cannot satisfy the tenant_isolation policy above. It gets two
-- narrow, role-scoped, command-scoped permissive policies (0040's shape):
--   - auth_bootstrap_read (SELECT): the login lookup and AccessControlService's
--     resolveDbUser, which is the ONE read that must work before the fleet pool
--     is reached.
--   - auth_bootstrap_write (UPDATE): AuthService.login stamps last_login_at on
--     the identified user. Under tenant_isolation alone this UPDATE would match
--     zero rows WITHOUT erroring (org = NULL, never true) and last_login_at
--     would silently stop being written — the same FORCE silent-no-op the
--     migrate path guards against. 0039 already restricts bms_auth's column
--     UPDATE grant to last_login_at, so this policy widens rows, not columns.
DROP POLICY IF EXISTS auth_bootstrap_read ON bms.users;
CREATE POLICY auth_bootstrap_read ON bms.users
  FOR SELECT TO bms_auth USING (true);

DROP POLICY IF EXISTS auth_bootstrap_write ON bms.users;
CREATE POLICY auth_bootstrap_write ON bms.users
  FOR UPDATE TO bms_auth USING (true) WITH CHECK (true);

-- 5b. Remove bms_auth's cross-org reach on locations/user_organization_access.
-- 0040 gave it read-only bootstrap policies there and 0039 gave it the table
-- grants, both stated to be temporary "E7.1 removes them" wideners. bms.users
-- now carries organization_id and AccessControlService resolves the home org on
-- bms_fleet, so bms_auth no longer walks those tables. Dropping the policies and
-- revoking the grants discharges Amendment 1's standing instruction; leaving
-- them would make the least-privilege claim false.
DROP POLICY IF EXISTS auth_bootstrap_read ON bms.locations;
DROP POLICY IF EXISTS auth_bootstrap_read ON bms.user_organization_access;

REVOKE SELECT ON bms.user_organization_access FROM bms_auth;
REVOKE SELECT ON bms.user_location_access FROM bms_auth;
REVOKE SELECT ON bms.locations FROM bms_auth;

RESET ROLE;
