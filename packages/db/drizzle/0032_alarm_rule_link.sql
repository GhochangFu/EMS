-- ADR 0033 / F3.6 — an alarm knows which rule raised it.
--
-- Today `bms.alarms` is written by exactly one code path, `AlarmThresholdService`,
-- which is two engines wearing one coat: it evaluates published DB rules AND a
-- hardcoded Eskom-only ladder, using two different dedupe keys. A shared
-- condition can therefore raise TWO open alarms for one breach — measured on
-- `UPS-A`: `demand_ceiling_notify` (a seeded rule, `kw >= 115`) and the
-- hardcoded `demand_high` (also `kw >= 115`) both fire, because `ensureAlarm`
-- dedupes on `(asset_id, rule_key)` and the two keys differ.
--
-- `rule_id` is the fix's foundation. Once every alarm-raising path is the same
-- engine (F3.6 tasks 3-5), a rule is raised at most once per asset while it is
-- open — enforced by the unique index below, not by a SELECT-then-INSERT that a
-- race can slip past (`ensureAlarm` does exactly that today: SELECT open, then
-- INSERT, with nothing stopping two concurrent reading batches from both seeing
-- nothing open).
--
-- Nullable, no ON DELETE. Nullable because historical alarms — raised before
-- this column existed, or by the hardcoded ladder before its equivalent DB
-- rules exist (migration 0033) — cannot always be attributed to a rule, and
-- forward-only migrations do not get to invent one. No ON DELETE clause is the
-- default NO ACTION: deleting a rule that still has alarms referencing it must
-- fail loudly. `automation_rules` is operator-managed CRUD with a lifecycle,
-- not a closed vocabulary nobody deletes the way `alarm_severities` is, so the
-- analogy to ADR 0032's posture only goes so far — the reason NO ACTION is
-- still right here is that alarm history must be dealt with explicitly before
-- a rule can go, not that rules are meant to be permanent.
--
-- **This is a delete-ordering constraint on every migration after this one
-- that removes rows from `bms.automation_rules`.** Migration review flagged
-- it: `0014_remove_smoc_pretoria_north.sql` and
-- `0021_remove_onboarding_demo_locations.sql` both delete rules outright, and
-- only `0021` happens to survive — it deletes the affected assets' alarms
-- first, an accident of ordering rather than a rule anyone wrote down. Any
-- future cleanup migration that deletes `bms.automation_rules` rows must
-- delete their `bms.alarms` rows (or null out `rule_id`) first, or this FK
-- aborts it. `rules.service.ts`'s `archiveRule` is unaffected — it is a soft
-- delete (`lifecycleStatus: 'archived'`), and there is no hard-delete
-- endpoint reachable from the API today.
--
-- Forward-only and idempotent, same discipline as migration 0030: `conname` is
-- unique per relation, not globally, so the constraint-existence checks below
-- are qualified by `conrelid` — an unqualified check would silently skip adding
-- the constraint if any other table anywhere happened to reuse the name.

-- 1. The column, unconstrained first — matching 0030's ordering: adding the
--    constraint before any data could violate it is what forces a bare
--    SQLSTATE 23503 instead of the readable preflight in step 3.
ALTER TABLE bms.alarms
  ADD COLUMN IF NOT EXISTS rule_id uuid;
--> statement-breakpoint

-- 2. Backfill from the one thing that already links an alarm to a rule:
--    `automation_rules.code` is UNIQUE (bms-schema.ts), so `rule_key = code` is
--    inherently a 1:1 match — no separate uniqueness guard is needed the way
--    migration 0022's asset-matching INSERTs need one.
--
--    This only catches alarms whose `rule_key` already equals a rule's `code`
--    today — i.e. alarms raised by a published DB rule. Alarms raised by the
--    hardcoded Eskom ladder carry ad-hoc keys (`demand_high`,
--    `voltage_l1_critical`, ...) that are not any rule's `code` yet; migration
--    0033 seeds the equivalent rules under new codes, so those historical rows
--    stay unlinked (`rule_id IS NULL`) rather than being backdated to a rule
--    that did not exist when they were raised. That is intentional, not a gap:
--    forward-only migrations record what happened, not what the schema wishes
--    had happened.
UPDATE bms.alarms a
   SET rule_id = r.id
  FROM bms.automation_rules r
 WHERE a.rule_id IS NULL
   AND a.rule_key = r.code;
--> statement-breakpoint

-- 3. Preflight: fail readably rather than cryptically.
--
--    The unique index in step 5 requires at most one open (unacknowledged) row
--    per (asset_id, rule_id). The backfill above cannot itself create such a
--    collision — it only ever sets a NULL to a single deterministic value keyed
--    by a UNIQUE column — but a live pilot database is not a fresh one: the
--    exact TOCTOU race this migration exists to close may already have written
--    two open rows for the same (asset_id, rule_key) pair before today. Without
--    this, step 5 aborts the entire pending-migration transaction on a bare
--    SQLSTATE 23505 naming an index, not an asset or a rule.
DO $$
DECLARE
  offender record;
BEGIN
  FOR offender IN
    SELECT asset_id, rule_id, count(*) AS open_rows
      FROM bms.alarms
     WHERE acknowledged_at IS NULL
       AND rule_id IS NOT NULL
     GROUP BY asset_id, rule_id
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION
      'ADR 0033: asset % already has % unacknowledged alarms open for rule %, which alarms_open_per_rule_uidx cannot allow. Acknowledge or merge the duplicates, then re-run.',
      offender.asset_id, offender.open_rows, offender.rule_id;
  END LOOP;
END $$;
--> statement-breakpoint

-- 4. Point the column at the vocabulary of rules.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alarms_rule_id_fk'
      AND conrelid = 'bms.alarms'::regclass
  ) THEN
    ALTER TABLE bms.alarms
      ADD CONSTRAINT alarms_rule_id_fk
      FOREIGN KEY (rule_id) REFERENCES bms.automation_rules(id);
  END IF;
END $$;
--> statement-breakpoint

-- 5. The dedupe, as a constraint instead of a SELECT-then-INSERT.
--
--    Partial: legacy rows with `rule_id IS NULL` are excluded on purpose, so
--    this migration never has to touch or clean up historical data to apply.
--    `acknowledged_at IS NULL` matches `ensureAlarm`'s existing "open" test —
--    a rule may reopen an alarm once its previous one has been acknowledged.
CREATE UNIQUE INDEX IF NOT EXISTS alarms_open_per_rule_uidx
  ON bms.alarms (asset_id, rule_id)
  WHERE acknowledged_at IS NULL AND rule_id IS NOT NULL;
