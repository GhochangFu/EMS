-- F2.13 / ADR 0052 — `bms.asset_templates` records which stock release a row
-- came from, mirroring `0056`'s `bms.dashboard_templates.stock_code` /
-- `stock_version` column for column.
--
-- WHY TWO COLUMNS, NOT A FIELD IN `content`. The stamp is QUERIED — "which
-- templates are stock imports", "which stock version is this row running" —
-- and `content` is the ADR 0019 authoring contract (KPIs, alarms, philosophy,
-- point ordering), owned by `apps/api`'s Zod layer, not a place a SQL WHERE
-- clause should reach into. Two narrow columns, indexed if a later row ever
-- needs it, keep the provenance query-shaped the way `0056`'s pair already
-- does for dashboard templates.
--
-- WHY NULLABLE. `bms.asset_templates` has live rows today, all of them
-- hand-authored, and neither column may be `NOT NULL` without a backfill this
-- row does not owe. A hand-authored template stays both-NULL forever.
--
-- A HALF-RECORDED PROVENANCE IS WORSE THAN NONE (`0056`'s own reasoning,
-- restated here rather than pointed at, because SQL has no imports —
-- `f3.1d`'s header makes the same call for its own CHECK). `stock_code`
-- without `stock_version` cannot answer "which stock did this come from", and
-- `stock_version` without `stock_code` names a release of nothing. Both NULL
-- is the hand-authored template, which is the common case; the CHECK below
-- closes the pair exactly as `dashboard_templates_stock_stamp_check` does.
--
-- ADR 0045 / AGENTS.md §4.4 — THIS FILE TAKES THE `SET ROLE bms_owner` /
-- `RESET ROLE` BRACKET, and says so because nothing machine-checks which
-- branch a migration picked. ADR 0052's Dependencies calls the bracket
-- unnecessary for this file BECAUSE THE FILE DROPS NO POLICY — `ADD COLUMN`
-- and a `CHECK` on an already-FORCE-RLS table need no default-privilege grant
-- and no `ALTER ... OWNER TO`. But `0060`'s header states the repo's DEFAULT
-- BRANCH is to take the bracket regardless: `bms_owner` owns
-- `bms.asset_templates`, and a forgotten `RESET ROLE` leaks past `COMMIT`
-- into the session, so drizzle's own journal `INSERT` and every later file in
-- the same run would execute as `bms_owner`, which holds no grant on the
-- `drizzle` schema. Taking the bracket here costs nothing and keeps every
-- migration in this repository following the one rule rather than two.
--
-- Forward-only and idempotent. Indexed 0061: 0056-0060 are committed and
-- frozen, and the journal `when` is strictly greater than 0060's
-- 1788870783386, or drizzle applies nothing and every check downstream passes
-- against a schema short two columns (`0024`'s header records this).

SET ROLE bms_owner;

ALTER TABLE bms.asset_templates
  ADD COLUMN IF NOT EXISTS stock_code varchar(64),
  ADD COLUMN IF NOT EXISTS stock_version integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'asset_templates_stock_stamp_check'
       AND conrelid = 'bms.asset_templates'::regclass
  ) THEN
    ALTER TABLE bms.asset_templates
      ADD CONSTRAINT asset_templates_stock_stamp_check
      CHECK ((stock_code IS NULL) = (stock_version IS NULL));
  END IF;
END $$;

RESET ROLE;
