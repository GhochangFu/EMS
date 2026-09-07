-- F3.10 / ADR 0057 decisions 1, 2, 3 and 7 — the alarm lifecycle.
--
-- Five things, in one file because the second depends on the first and the
-- third on the second, and they must land in one transaction:
--
--   1. `bms.alarms` gains `cleared_at` and `normal_since`; `bms.automation_rules`
--      gains `clear_hold_seconds` (decisions 1 and 3).
--   2. Every acknowledged alarm is backfilled `cleared_at = acknowledged_at`
--      (decision 2), so the predicate swap in step 3 cannot collide — guarded
--      on the old index predicate, so a replay backfills nothing.
--   3. `alarms_open_per_rule_uidx` moves from `acknowledged_at IS NULL` to
--      `cleared_at IS NULL` (decision 2). An acknowledged alarm whose condition
--      still holds no longer re-raises as a new row; a new row opens only after
--      the previous one clears and the condition breaches again.
--   4. Four tenant tables for escalation profiles (decision 7), each under the
--      ADR 0043 shape: `ENABLE` + `FORCE ROW LEVEL SECURITY` and a
--      `tenant_isolation` policy.
--   5. Two `bms.notification_deliveries` indexes for the readers PR 1 added
--      (plan Q3 and the PR 1 code review), and the drop of `0065`'s index the
--      first of them subsumes.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING (ADR 0045 / AGENTS.md §4.4). Two
-- reasons, both the usual ones. `FORCE ROW LEVEL SECURITY` binds the table
-- owner, so the four new tables must be owned by `bms_owner` or the flip is
-- decorative (`F4.16`). And `0041:112-113`'s `ALTER DEFAULT PRIVILEGES FOR ROLE
-- bms_owner IN SCHEMA bms GRANT ... TO bms_tenant, bms_fleet` fires only for
-- objects the named role creates, while `pnpm db:migrate` connects as
-- DATABASE_URL_SUPERUSER (`bms_app`). Without the bracket the tables would be
-- owned by `bms_app`, no pool role could read them, and the failure would
-- surface one endpoint at a time (`0039`). `bms_owner` owns `bms.alarms`,
-- `bms.automation_rules` and `bms.notification_deliveries` (measured), so the
-- ALTERs and the index DDL are ordinary writes the owner may make.
--
-- THEREFORE: NO EXPLICIT GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED.
-- The default privileges do it for all four tables. A hand-written GRANT would
-- be redundant and would hide a future breakage of the SET ROLE bracket
-- (`0050`, `0051` and `0056` say the same). `RESET ROLE` is the half that
-- bites: a forgotten one leaks past `COMMIT` into the session, so drizzle's own
-- journal `INSERT` and every later file in the same run would execute as
-- `bms_owner`, which holds no grant on the `drizzle` schema.
--
-- WHY THE BACKFILL LOOPS ORGANISATIONS (plan D5, `0046`'s shape). `bms.alarms`
-- carries `FORCE ROW LEVEL SECURITY` (`0047`), and `FORCE` binds `bms_owner`.
-- As `bms_owner` with no tenant GUC the `tenant_isolation` policy admits ZERO
-- rows, so a bare `UPDATE bms.alarms ...` would succeed, touch nothing, and
-- the index below would still build — the exact trap
-- `tests/adr-0043-tenant-columns.test.ts` records for `0046`. The loop sets
-- `app.current_organization` per organisation (transaction-local, third
-- argument `true`), and each iteration sees exactly that organisation's rows.
-- `bms.organizations` is not policied, so the loop source is fully visible.
-- ADR 0045 §4 forbids the simpler superuser bypass. The GUC is reset to '' at
-- the end — outside the `IF` — so nothing later in this transaction runs with
-- a tenant set, whether or not the guarded backfill fired.
--
-- WHY THE INDEX IS DROPPED AND RE-CREATED AFTER THE BACKFILL, IN THE SAME
-- TRANSACTION. Index DDL is not subject to row-level security, so the
-- `CREATE UNIQUE INDEX` sees every row. Drizzle runs this file inside one
-- transaction (`packages/db/src/migrate.ts`), so no raise can land between the
-- `DROP INDEX` and the `CREATE`. If a database somewhere holds two
-- `cleared_at IS NULL` rows for one `(asset_id, rule_id)` — which only a row
-- with `acknowledged_at` set and a later open duplicate could produce, and the
-- backfill above closes the first — the `CREATE` fails loudly with SQLSTATE
-- 23505, which is the right outcome: `0032` did the same with a pre-check
-- `DO` block, and here the `CREATE` itself is the duplicate check.
--
-- WHY `alarms_open_rule_idx` IS LEFT ALONE. The `0001` partial index
-- `(asset_id, rule_key) WHERE acknowledged_at IS NULL AND rule_key IS NOT NULL`
-- is a pre-`F3.6` leftover with no reader in code (measured: the only readers
-- of `acknowledged_at IS NULL` are the acknowledge route and two spec lines).
-- It is dead weight, and dropping it is a scope this row was not given. A
-- later sweep should drop it; this header is the record that it was seen.
--
-- WHY NO `CHECK` ON `clear_hold_seconds`. The 1..86 400 s bound is enforced in
-- `apps/api`'s Zod layer (plan Q2), the `0062` precedent: a nullable column
-- with no `CHECK`, because a database bound would duplicate one the schema
-- already owns and could drift from it. `NULL` means the 120 s default, applied
-- where the value is consumed, not on the write path (plan D16).
--
-- WHY THE POLICIES HAVE THE LEGS THEY HAVE (plan D6). `alarm_escalation_profiles`
-- and `alarm_escalation_defaults` carry `organization_id NOT NULL` and an
-- own-column `tenant_isolation` (`0047:116-118`'s shape). `defaults` ADDS a
-- parent leg on `profile_id`: Postgres runs a referential-integrity check with
-- row security OFF, so a foreign key never consults the parent's policy
-- (`0056:279-291`, proved on the running stack by `0050`'s review), and without
-- the leg a tenant could map its severity to ANOTHER tenant's profile.
-- `alarm_escalation_steps` and `alarm_escalation_step_channels` are junctions
-- with no column of their own (the `rule_notifications` precedent,
-- `0047:262-272`): steps police through their profile, step channels through
-- step -> profile. THE CHANNEL LEG IS DELIBERATELY NOT IN THE STEP-CHANNELS
-- POLICY: `rule_notifications` does not check the channel's organisation
-- either, because a fleet-wide (`NULL`-org) channel is a legitimate target
-- (ADR 0043 Amendment 5, decision 7); the service gates channel scope in code
-- (plan D8, and `dispatchToChannels` drops a foreign-org channel — PR 1
-- review M2). Every policy gates `WITH CHECK` as well as `USING`.
--
-- FOREIGN-KEY ACTIONS. `steps.profile_id` and `step_channels.step_id` are
-- `ON DELETE CASCADE`: configuration cascades with its parent, as
-- `rule_notifications.rule_id` does. `step_channels.channel_id` and
-- `defaults.profile_id` are `NO ACTION`: deleting a channel a step still names,
-- or a profile a severity still maps to, fails loudly (`0038`'s reasoning for
-- `rule_notifications.channel_id`). `defaults.severity` references
-- `bms.alarm_severities(code)`, so an unknown severity is refused by the
-- database rather than by a module import that would make the
-- `NotificationsModule` -> `VocabulariesModule` edge cyclic (plan D11).
-- Constraints are named so the service can translate a 23503/23505 into a
-- 400 by name, the way `channels.service.ts` does for its organisation FK.
--
-- NO SEED (ADR 0057 decision 8). Nothing escalates until an operator
-- configures a profile; this file inserts no row in any of the four tables.
--
-- WHY THE TWO DELIVERIES INDEXES (`0038`'s rule: the reader adds the index).
-- `NotificationsService.eventDeliveryBlocked` (PR 1) reads
-- `(channel_id, organization_id, dedupe_key)` for ANY status once per step or
-- cleared message per channel per tick; `notification_deliveries_channel_key_idx
-- ON (channel_id, dedupe_key) WHERE dedupe_key IS NOT NULL` is its probe (plan
-- Q3, owner-ruled). `sentChannelIdsForAlarm` is `alarm_id`'s first reader, and
-- `notification_deliveries_alarm_idx ON (alarm_id) WHERE alarm_id IS NOT NULL`
-- is its index (PR 1 code review). Both partial: a `NULL` key or alarm can
-- never satisfy either read, so the index is maintained only on rows that can.
--
-- WHY `0065`'s `notification_deliveries_dedupe_skip_idx` IS DROPPED HERE. It is
-- `(channel_id, dedupe_key) WHERE status = 'skipped_deduped'` — the same key
-- columns as the channel-key index above. `hasRecordedSkip`'s
-- `dedupe_key = $x` implies `dedupe_key IS NOT NULL`, so the planner can use
-- the wider index and apply the status filter after (exactly as `0038` applies
-- the status filter after `notification_deliveries_channel_time_idx`). Two
-- indexes over the same columns cost a write each on every row for one
-- reader's worth of benefit. `0065`'s own rule read in reverse: the migration
-- that makes an index readerless drops it. `0065` itself is frozen and is not
-- edited; `tests/f3.46-notification-deliveries-dedupe-index.test.ts` still
-- asserts that file and the reader, and both stay true.
--
-- WHY NO CONCURRENTLY. Drizzle applies the file inside one transaction and
-- Postgres refuses `CREATE INDEX CONCURRENTLY` inside one (AGENTS.md §4.4).
-- `bms.notification_deliveries` has 0 rows in every measured environment and
-- `bms.alarms` has 121 on the dev database, so the write lock is momentary.
--
-- Forward-only and idempotent (AGENTS.md §4.4): every `ADD COLUMN` and
-- `CREATE TABLE`/`CREATE INDEX` is `IF NOT EXISTS`, every `DROP` is
-- `IF EXISTS`, and every policy is `DROP POLICY IF EXISTS` then `CREATE`.
--
-- THE BACKFILL IS THE ONE STATEMENT `IF NOT EXISTS` CANNOT MAKE RE-RUNNABLE,
-- AND ITS PREDICATE IS NOT ITS GUARD. `acknowledged_at IS NOT NULL AND
-- cleared_at IS NULL` selects "already closed" only under the OLD index; after
-- step 3 it is the ordinary steady state of a live alarm (decision 1:
-- acknowledged and still active). A hand replay of an unguarded file would
-- therefore back-date `cleared_at` on every live acknowledged alarm and free
-- its dedupe slot, letting the next tick raise a duplicate. So step 2 is
-- wrapped in `IF EXISTS (SELECT 1 FROM pg_indexes ... indexdef LIKE
-- '%acknowledged_at IS NULL%')`: the OLD predicate still in the catalogue is
-- the marker for "not yet migrated", and step 3's `DROP`/`CREATE` is what
-- flips it — which is why the order backfill -> swap must stay. ON A REPLAY THE
-- BACKFILL DOES NOTHING and every remaining statement is a skip
-- (expect `notification_deliveries_dedupe_skip_idx does not exist, skipping`,
-- dropped by the first run). The deliberate trade: on a database where the
-- index is absent ENTIRELY the guard also skips, and the
-- `CREATE UNIQUE INDEX` below then fails loudly with 23505 if duplicates
-- exist — a refusal to migrate, which is the right outcome, rather than a
-- silent back-date.
--
-- Indexed 0066: `0056`-`0065` are committed and frozen, and the journal `when`
-- is strictly greater than `0065`'s 1788705366591, or drizzle applies nothing
-- and every check downstream passes against a schema short two columns and four
-- tables (`0024`'s header records this).

SET ROLE bms_owner;

-- 1. The two stamps (decision 1) and the hold (decision 3). All nullable: a
--    NULL `cleared_at` is "active", a NULL `normal_since` is "not yet seen
--    non-matching", a NULL `clear_hold_seconds` is the 120 s default.
ALTER TABLE bms.alarms
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
ALTER TABLE bms.alarms
  ADD COLUMN IF NOT EXISTS normal_since timestamptz;
ALTER TABLE bms.automation_rules
  ADD COLUMN IF NOT EXISTS clear_hold_seconds integer;

-- 2. Backfill (decision 2), per organisation under the GUC — `0046`'s shape —
--    and ONLY on a database that has not yet had step 3 applied. Under the OLD
--    predicate an acknowledged alarm was already closed, so its `cleared_at` is
--    its `acknowledged_at`: the moment it left the open set. Under the NEW one
--    the same rows are the ordinary steady state, so the `IF EXISTS` guard is
--    what keeps a replay from back-dating every live acknowledged alarm — see
--    the idempotency paragraph in the header. The guard reads the catalogue
--    BEFORE step 3's `DROP INDEX` removes the marker it tests.
DO $$
DECLARE
  org record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'bms' AND indexname = 'alarms_open_per_rule_uidx'
                AND indexdef LIKE '%acknowledged_at IS NULL%') THEN
    FOR org IN SELECT id FROM bms.organizations LOOP
      PERFORM set_config('app.current_organization', org.id::text, true);
      UPDATE bms.alarms
         SET cleared_at = acknowledged_at
       WHERE acknowledged_at IS NOT NULL
         AND cleared_at IS NULL;
    END LOOP;
  END IF;
  -- Outside the IF on purpose: nothing later in this transaction may run with
  -- a tenant set, whether or not the backfill fired.
  PERFORM set_config('app.current_organization', '', true);
END
$$;

-- 3. The dedupe predicate moves (decision 2). One transaction; the CREATE is
--    the duplicate check.
DROP INDEX IF EXISTS bms.alarms_open_per_rule_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_per_rule_uidx
  ON bms.alarms (asset_id, rule_id)
  WHERE cleared_at IS NULL AND rule_id IS NOT NULL;

-- 4. Four tenant tables (decision 7).
CREATE TABLE IF NOT EXISTS bms.alarm_escalation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    CONSTRAINT alarm_escalation_profiles_organization_id_fk
    REFERENCES bms.organizations(id),
  code varchar(64) NOT NULL,
  name varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alarm_escalation_profiles_org_code_key UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS bms.alarm_escalation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL
    CONSTRAINT alarm_escalation_steps_profile_id_fk
    REFERENCES bms.alarm_escalation_profiles(id) ON DELETE CASCADE,
  step_no integer NOT NULL,
  after_minutes integer NOT NULL,
  CONSTRAINT alarm_escalation_steps_profile_step_key UNIQUE (profile_id, step_no)
);

CREATE TABLE IF NOT EXISTS bms.alarm_escalation_step_channels (
  step_id uuid NOT NULL
    CONSTRAINT alarm_escalation_step_channels_step_id_fk
    REFERENCES bms.alarm_escalation_steps(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL
    CONSTRAINT alarm_escalation_step_channels_channel_id_fk
    REFERENCES bms.notification_channels(id),
  PRIMARY KEY (step_id, channel_id)
);

CREATE TABLE IF NOT EXISTS bms.alarm_escalation_defaults (
  organization_id uuid NOT NULL
    CONSTRAINT alarm_escalation_defaults_organization_id_fk
    REFERENCES bms.organizations(id),
  severity varchar(64) NOT NULL
    CONSTRAINT alarm_escalation_defaults_severity_fk
    REFERENCES bms.alarm_severities(code),
  profile_id uuid NOT NULL
    CONSTRAINT alarm_escalation_defaults_profile_id_fk
    REFERENCES bms.alarm_escalation_profiles(id),
  PRIMARY KEY (organization_id, severity)
);

--    ENABLE first, then the policies, then FORCE — `0047`'s order. ENABLE
--    exempts the owner; FORCE does not (ADR 0043 decision 12). `bms_fleet`'s
--    BYPASSRLS is a role attribute FORCE does not restrain, which is what
--    keeps the sweep's catalogue read whole (plan D13).
ALTER TABLE bms.alarm_escalation_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_steps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_step_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_defaults      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_escalation_profiles;
CREATE POLICY tenant_isolation ON bms.alarm_escalation_profiles
  USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_escalation_defaults;
CREATE POLICY tenant_isolation ON bms.alarm_escalation_defaults
  USING (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.alarm_escalation_profiles p
                 WHERE p.id = alarm_escalation_defaults.profile_id
                   AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    organization_id = nullif(current_setting('app.current_organization', true), '')::uuid
    AND EXISTS (SELECT 1 FROM bms.alarm_escalation_profiles p
                 WHERE p.id = alarm_escalation_defaults.profile_id
                   AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_escalation_steps;
CREATE POLICY tenant_isolation ON bms.alarm_escalation_steps
  USING (
    EXISTS (SELECT 1 FROM bms.alarm_escalation_profiles p
             WHERE p.id = alarm_escalation_steps.profile_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.alarm_escalation_profiles p
             WHERE p.id = alarm_escalation_steps.profile_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

DROP POLICY IF EXISTS tenant_isolation ON bms.alarm_escalation_step_channels;
CREATE POLICY tenant_isolation ON bms.alarm_escalation_step_channels
  USING (
    EXISTS (SELECT 1 FROM bms.alarm_escalation_steps s
              JOIN bms.alarm_escalation_profiles p ON p.id = s.profile_id
             WHERE s.id = alarm_escalation_step_channels.step_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM bms.alarm_escalation_steps s
              JOIN bms.alarm_escalation_profiles p ON p.id = s.profile_id
             WHERE s.id = alarm_escalation_step_channels.step_id
               AND p.organization_id = nullif(current_setting('app.current_organization', true), '')::uuid)
  );

ALTER TABLE bms.alarm_escalation_profiles      FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_steps         FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_step_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE bms.alarm_escalation_defaults      FORCE ROW LEVEL SECURITY;

-- 5. The readers' indexes (plan Q3; PR 1 code review), and the drop of the
--    index the first one subsumes.
CREATE INDEX IF NOT EXISTS notification_deliveries_channel_key_idx
  ON bms.notification_deliveries (channel_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

DROP INDEX IF EXISTS bms.notification_deliveries_dedupe_skip_idx;

CREATE INDEX IF NOT EXISTS notification_deliveries_alarm_idx
  ON bms.notification_deliveries (alarm_id)
  WHERE alarm_id IS NOT NULL;

RESET ROLE;
