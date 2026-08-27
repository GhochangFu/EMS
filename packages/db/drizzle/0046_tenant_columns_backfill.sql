-- E7.1b / ADR 0043 decision 5 (+ Amendment 4), decisions 6 and 11.
--
-- The ADDITIVE half of the tenant boundary: add `organization_id` (nullable) to
-- every tenant-bearing table, grant the new `bms.users` column to the pool
-- roles, and backfill from the FK graph. The ENFORCEMENT half — `SET NOT NULL`,
-- `tenant_isolation` policies, `FORCE ROW LEVEL SECURITY`, and the Amendment-4
-- `bms_auth` policy swap — is migration `0047`, which runs after the write path
-- supplies the column. Landing them apart keeps this pass purely additive and
-- reviewable on its own.
--
-- The 19 tables are decision 5's 13, plus `users` (Amendment 4), plus the five
-- the E7.1b Task 0 audit found tenant-bearing but unlisted, ruled in on decision
-- 5's "at minimum": `rtu_connection_configs` (encrypted RTU credentials),
-- `alarm_enrichments`, `work_order_tasks`, `maintenance_task_templates`,
-- `template_points`. Junctions (`asset_group_members`, `rule_notifications`,
-- `alarm_affected_assets`) inherit through their parent — no column here.
--
-- Runs under `SET ROLE bms_owner` (ADR 0045): `bms_owner` owns the tables and
-- can ALTER/GRANT them, and no statement needs SUPERUSER. Forward-only and
-- idempotent (AGENTS.md §4): every `ADD COLUMN` is `IF NOT EXISTS`, every GRANT
-- re-runs cleanly, and every backfill UPDATE is guarded on `organization_id IS
-- NULL`.

SET ROLE bms_owner;

-- 1. The column, nullable, on all 19 tenant tables. FK to bms.organizations.
ALTER TABLE bms.users                     ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.rtus                      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.assets                    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.asset_groups              ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.asset_points              ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.alarms                    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.automation_rules          ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.rule_executions           ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.notification_channels     ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.notification_deliveries   ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.work_orders               ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.maintenance_schedules     ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.maintenance_history       ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.audit_log                 ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.rtu_connection_configs    ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.alarm_enrichments         ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.work_order_tasks          ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.maintenance_task_templates ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);
ALTER TABLE bms.template_points           ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES bms.organizations(id);

-- 2. Grant the new bms.users.organization_id column to the pool roles.
--
-- 0039 revoked table-level SELECT/UPDATE on bms.users and re-granted column by
-- column, so a column added without naming it here is unreadable to the pool
-- roles (0039:80-81). `bms_auth` needs SELECT on it to read the home org during
-- the pre-tenant bootstrap that E7.1b introduces; it never updates it (only
-- `last_login_at`, per 0039). GRANT is additive and idempotent.
GRANT SELECT (organization_id) ON bms.users TO bms_tenant, bms_fleet, bms_auth;
GRANT UPDATE (organization_id) ON bms.users TO bms_tenant, bms_fleet;

-- 3. Backfill from the FK graph, inside a per-organization loop.
--
-- The Tier-1 tables resolve through bms.locations, which carries FORCE ROW LEVEL
-- SECURITY (0040/0041) that binds bms_owner. As bms_owner with no tenant GUC the
-- locations JOIN sees ZERO rows, so every child would stay NULL and the abort in
-- step 4 would fire on rows that are in fact resolvable — the backfill trap. The
-- loop sets `app.current_organization` per organization; a policied source
-- (locations, user_organization_access, asset_templates) then shows exactly that
-- organization's rows, and an unpoliced source is filtered by `= org_id`. This
-- honours the ADR 0045 rule that a migration must not require SUPERUSER; the
-- simpler `bms_app` bypass is rejected for that reason.
--
-- Tiers run in dependency order WITHIN each iteration: Tier 2 reads the
-- organization_id Tier 1 just wrote on this organization's rows, Tier 3 reads
-- Tier 2's. `bms.organizations` is not policied, so the loop source is fully
-- visible.
DO $$
DECLARE
  org_id uuid;
BEGIN
  FOR org_id IN SELECT id FROM bms.organizations LOOP
    PERFORM set_config('app.current_organization', org_id::text, true);

    -- Tier 1: from bms.locations (policied -> only this org visible).
    UPDATE bms.assets a       SET organization_id = org_id FROM bms.locations l WHERE a.location_id = l.id AND l.organization_id = org_id AND a.organization_id IS NULL;
    UPDATE bms.asset_groups g SET organization_id = org_id FROM bms.locations l WHERE g.location_id = l.id AND l.organization_id = org_id AND g.organization_id IS NULL;
    UPDATE bms.rtus r         SET organization_id = org_id FROM bms.locations l WHERE r.location_id = l.id AND l.organization_id = org_id AND r.organization_id IS NULL;

    -- Tier 2: from bms.assets / bms.rtus (this org's rows, just filled).
    UPDATE bms.asset_points p             SET organization_id = org_id FROM bms.assets a WHERE p.asset_id = a.id AND a.organization_id = org_id AND p.organization_id IS NULL;
    UPDATE bms.alarms al                  SET organization_id = org_id FROM bms.assets a WHERE al.asset_id = a.id AND a.organization_id = org_id AND al.organization_id IS NULL;
    -- automation_rules.asset_id is NULLABLE (a time_window rule carries no asset,
    -- decision 6). Such a row stays NULL and ABORTS in step 4 by design
    -- (decision 11). The Task 0 audit measured 0 such rows on the pilot DB.
    UPDATE bms.automation_rules ar        SET organization_id = org_id FROM bms.assets a WHERE ar.asset_id = a.id AND a.organization_id = org_id AND ar.organization_id IS NULL;
    UPDATE bms.work_orders w              SET organization_id = org_id FROM bms.assets a WHERE w.asset_id = a.id AND a.organization_id = org_id AND w.organization_id IS NULL;
    UPDATE bms.maintenance_history m      SET organization_id = org_id FROM bms.assets a WHERE m.asset_id = a.id AND a.organization_id = org_id AND m.organization_id IS NULL;
    UPDATE bms.maintenance_task_templates mt SET organization_id = org_id FROM bms.assets a WHERE mt.asset_id = a.id AND a.organization_id = org_id AND mt.organization_id IS NULL;
    UPDATE bms.rtu_connection_configs rc  SET organization_id = org_id FROM bms.rtus r  WHERE rc.rtu_id = r.id  AND r.organization_id = org_id AND rc.organization_id IS NULL;

    -- Tier 3: from a Tier-2 table (this org's rows, just filled).
    UPDATE bms.rule_executions e   SET organization_id = org_id FROM bms.automation_rules ar        WHERE e.rule_id = ar.id           AND ar.organization_id = org_id AND e.organization_id IS NULL;
    UPDATE bms.alarm_enrichments ae SET organization_id = org_id FROM bms.alarms al                 WHERE ae.alarm_id = al.id         AND al.organization_id = org_id AND ae.organization_id IS NULL;
    UPDATE bms.work_order_tasks wt SET organization_id = org_id FROM bms.work_orders w              WHERE wt.work_order_id = w.id     AND w.organization_id = org_id  AND wt.organization_id IS NULL;
    -- maintenance_schedules has NO asset_id; it resolves through its task
    -- template's asset (Task 0 audit correction — NOT asset_templates).
    UPDATE bms.maintenance_schedules ms SET organization_id = org_id FROM bms.maintenance_task_templates mt WHERE ms.template_id = mt.id AND mt.organization_id = org_id AND ms.organization_id IS NULL;
    -- notification_deliveries is NULLABLE this item (decision 7 / E7.1c). Its
    -- alarm_id is the resolving source (alarms get NOT NULL org); a delivery with
    -- no alarm stays NULL, which is permitted. Table is empty on the pilot DB.
    UPDATE bms.notification_deliveries nd SET organization_id = org_id FROM bms.alarms al WHERE nd.alarm_id = al.id AND al.organization_id = org_id AND nd.organization_id IS NULL;

    -- asset_templates is a policied F4.16 table (has org); template_points is its
    -- child. Empty on the pilot DB.
    UPDATE bms.template_points tp SET organization_id = org_id FROM bms.asset_templates t WHERE tp.template_id = t.id AND t.organization_id = org_id AND tp.organization_id IS NULL;

    -- bms.users home org (Amendment 4): the user's own grants, three paths. The
    -- asset-group path is the Task 0 audit addition — `wc-hvac-admin`
    -- (asset_group_admin) resolves only through it. A multi-organization actor
    -- takes whichever organization's iteration matches first; phase-1 actors hold
    -- one organization (measured), so this is deterministic in practice. A
    -- role='admin' user with no grant stays NULL by design (a global fleet
    -- actor); a scoped user with no resolvable home ABORTS in step 4.
    UPDATE bms.users u SET organization_id = org_id
    WHERE u.organization_id IS NULL AND (
      EXISTS (SELECT 1 FROM bms.user_organization_access x WHERE x.user_id = u.id AND x.organization_id = org_id)
      OR EXISTS (SELECT 1 FROM bms.user_location_access x JOIN bms.locations l ON l.id = x.location_id WHERE x.user_id = u.id AND l.organization_id = org_id)
      OR EXISTS (SELECT 1 FROM bms.user_asset_group_access x JOIN bms.asset_groups g ON g.id = x.asset_group_id WHERE x.user_id = u.id AND g.organization_id = org_id)
    );
  END LOOP;
END
$$;

-- 4. Abort, listing ids, on any tenant-scoped row that resolved to no
-- organization. These are the 15 tables that get SET NOT NULL in 0047: the 10
-- decision-5 NOT-NULL tables plus the 5 audit-added extras. The nullable-by-
-- design tables (audit_log, users, notification_channels, notification_
-- deliveries) are checked separately or not at all.
--
-- A tenant row with no organization is a data error, not a default (decision
-- 11) — fail loud so a human triages it before 0047's NOT NULL.
DO $$
DECLARE
  tbl text;
  n bigint;
  ids uuid[];
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'assets','asset_groups','asset_points','rtus','alarms','automation_rules',
    'rule_executions','work_orders','maintenance_schedules','maintenance_history',
    'rtu_connection_configs','alarm_enrichments','work_order_tasks',
    'maintenance_task_templates','template_points'
  ] LOOP
    EXECUTE format('SELECT count(*), array_agg(id) FROM bms.%I WHERE organization_id IS NULL', tbl)
      INTO n, ids;
    IF n > 0 THEN
      RAISE EXCEPTION 'E7.1b 0046: % row(s) in bms.% have no resolvable organization_id: %',
        n, tbl, ids;
    END IF;
  END LOOP;

  -- bms.users: a role='admin' user is a global fleet actor and may be NULL; any
  -- OTHER role with no resolvable home is a data error.
  SELECT count(*), array_agg(id) INTO n, ids
  FROM bms.users WHERE organization_id IS NULL AND role <> 'admin';
  IF n > 0 THEN
    RAISE EXCEPTION 'E7.1b 0046: % non-admin user(s) have no resolvable home organization_id: %',
      n, ids;
  END IF;
END
$$;

RESET ROLE;
