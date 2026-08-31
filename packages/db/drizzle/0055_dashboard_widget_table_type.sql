-- F3.35 Stage B / ADR 0048 decision 5 — the fifth widget type.
--
-- This migration widens `dashboard_widgets_widget_type_check` to accept `'table'`, and does
-- nothing else. It lands together with `apps/web/src/components/widgets/table-widget.tsx`,
-- which is the component that draws the value it admits.
--
-- WHY THE NUMBER IS `0055` AND NOT THE `0051` ADR 0048 NAMES. Decision 5 names `0051`;
-- Errata 1 corrects that to "the next free number, read from this directory" after `F3.37`
-- took `0051` on the day the ADR was accepted. Errata 1 then said the next free number was
-- `0054` — which Stage C took. Errata 3 records both corrections. The rule that survives all
-- three is the only durable one: AN ADR NAMES A MIGRATION'S JOB, NEVER ITS NUMBER. Read the
-- directory.
--
-- WHY THE JOURNAL `when` IS STAMPED ABOVE `0054`'s. `0054`'s `when` (1788352383386) was
-- hand-set roughly 31 hours ahead of the wall clock at the time it was written. Drizzle
-- orders by `when`, so a `0055` stamped from the real clock would sort BEFORE `0054`: on a
-- fresh database the two would run out of order, and on every database where `0054` is
-- already applied `0055` would be treated as older than the last-applied entry and silently
-- skipped. The value below is `0054`'s plus one day.
--
-- WHY THIS IS A SEPARATE MIGRATION FROM `0054` AT ALL. Decision 5 and the ADR's Consequences
-- both describe ONE migration that "widens a CHECK and creates a table". That sentence was
-- written assuming Stage B would land before Stage C. Decision 6's own staging table says the
-- opposite — Stage B depends on Stage C's dataset half for its rows — so the ADR contradicts
-- itself and decision 6 wins. ADR 0048 Errata 3 records this, and corrects a sentence in
-- `0054`'s header that attributed the unbundling to an owner ruling that was never made.
--
-- WHY `DROP` + `ADD` AND NOT THE `IF NOT EXISTS` GUARD `0053` USES. `0053` adds a constraint
-- that does not exist yet, so `IF NOT EXISTS` is the right idempotency check there. Here the
-- constraint ALREADY EXISTS, carrying `0050`'s four-value list. An existence check would find
-- it, conclude there was nothing to do, and skip the widening entirely — leaving a database
-- that refuses every `table` widget while reporting a successful migration. DROP IF EXISTS
-- followed by ADD is idempotent on its own: a second run drops the widened constraint and
-- re-adds it identically.
--
-- THE LOCK. `ADD CONSTRAINT` on a CHECK validates existing rows and takes ACCESS EXCLUSIVE,
-- which `0031`'s header measures and warns about for `telemetry.point_values`. That warning
-- does not transfer: `bms.dashboard_widgets` is a configuration table holding at most
-- `MAX_DASHBOARD_WIDGETS` rows per dashboard, so the validation scan is trivial and the lock
-- is held for microseconds. No `NOT VALID` + `VALIDATE CONSTRAINT` split is needed, and using
-- one would leave the constraint unvalidated if the second step were ever skipped.
--
-- WHY WIDENING IS SAFE IN THE OTHER DIRECTION TOO. A widened CHECK accepts every value the
-- narrow one did, so no stored row can fail it and no rollback of application code is broken
-- by it: an older `apps/api` simply never writes `'table'`. This is forward-only (§4.4) and
-- there is no down migration, per this repository's convention.
--
-- NO `SET ROLE bms_owner` BRACKET, and that is deliberate rather than an omission. `0051`'s
-- header records the rule and `0053`'s repeats it: ownership does not change on `ALTER TABLE`,
-- and `bms.dashboard_widgets` is already owned by `bms_owner` from `0050`'s own bracket.
--
-- THE CHECK AND `widgetTypeSchema` ARE TWO DECLARATIONS OF ONE VOCABULARY, and drift between
-- them is the `F4.43` failure: a value the database accepts that no renderer can draw, or one
-- the renderer offers that the database refuses with a constraint name in a 500.
-- `tests/f3.35-table-widget-schema.test.ts` parses the IN list below and compares it to the
-- enum parsed out of `packages/shared/src/contracts/dashboard-builder.ts`, so drift fails the
-- build rather than a page.

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table'));
