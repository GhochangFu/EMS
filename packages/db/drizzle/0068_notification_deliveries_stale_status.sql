-- F3.52 / ADR 0041 Amendment 6 ruling 5 — the sixth delivery status.
--
-- This migration widens `notification_deliveries_status_check` to accept `'skipped_stale'`,
-- and does nothing else. It lands with the escalation staleness predicate that writes the
-- row: a due step further past its due instant than the step-lateness budget Amendment 6
-- ruling 6 sets (`STEP_MAX_LATENESS` there, 60 minutes by default) is abandoned, and the
-- abandonment is RECORDED rather than logged, so an operator reading the deliveries view can
-- see that a step was owed, was never sent, and was dropped for age rather than for
-- configuration, dedupe or the hourly ceiling.
--
-- WHY THE NUMBER IS `0068`. It was read from this directory: `0067_template_alarm_provenance`
-- is the last file here and the last entry in `meta/_journal.json`. Amendment 6 names `0068`
-- too, and that agreement is worth nothing — ADR 0048 Errata 1 and 3 record two separate
-- occasions when a number an ADR named had been taken by another row between acceptance and
-- build. The durable rule is `0055`'s: AN ADR NAMES A MIGRATION'S JOB, NEVER ITS NUMBER.
--
-- WHY `DROP` + `ADD` AND NOT AN `IF NOT EXISTS` GUARD. `0055`'s argument for its own widening
-- transfers verbatim. The constraint ALREADY EXISTS, carrying `0038`'s five-value list, so an
-- existence check would find it, conclude there was nothing to do, and skip the widening
-- entirely — leaving a database that refuses every `skipped_stale` row while the migration
-- reports success, and the refusal would then surface as a constraint name in a 500 on the
-- dispatch path. `DROP CONSTRAINT IF EXISTS` followed by `ADD` is idempotent on its own: a
-- second run drops the widened constraint and re-adds it identically.
--
-- WHY `NOT VALID` + `VALIDATE`, WHERE `0055` USED A PLAIN `ADD`. `0055`'s "the lock is held
-- for microseconds" reasoning does NOT transfer. `bms.dashboard_widgets` is a bounded
-- configuration table; `bms.notification_deliveries` is an append-only ledger carrying one row
-- per dispatch attempt (ADR 0041 decision 4), which grows for the life of a deployment. A
-- plain `ADD CONSTRAINT` scans and validates every stored row while holding ACCESS EXCLUSIVE.
-- `NOT VALID` skips that scan, and the Postgres documentation for `ALTER TABLE ... VALIDATE
-- CONSTRAINT` states the weaker lock the second step then takes. That is documentation, not
-- something measured here, and the reduction it describes is partial in any case: the `DROP`
-- above takes ACCESS EXCLUSIVE whatever follows it. What was measured on this file is only
-- that the three statements apply, that `convalidated` reads `t` afterwards, and that
-- re-running all three is clean.
--
-- WHAT THAT SPLIT DOES NOT BUY, stated because leaving it unsaid would make the paragraph
-- above a false claim about this repository's runner. Under `pnpm db:migrate` the reduction
-- does not happen: drizzle-orm 0.38.4's migrator wraps the whole pending run in ONE
-- transaction (`drizzle-orm/pg-core/dialect.cjs` — `await session.transaction(...)` around
-- every pending file's statements; `0065`'s header records the same transaction as its reason
-- for excluding `CREATE INDEX CONCURRENTLY`). Locks are held to COMMIT, so the ACCESS
-- EXCLUSIVE the `ADD` takes is held across the `VALIDATE` anyway and the weaker lock is
-- subsumed. The split is kept because it costs nothing and it is the shape that helps in the
-- case that is not the runner: a file replayed statement by statement with `psql -f` on a
-- deployment whose ledger is large. It is NOT a claim that `pnpm db:migrate` avoids the table
-- lock.
--
-- WHY `NOT VALID` IS SAFE HERE REGARDLESS. The six-value list is a strict superset of `0038`'s
-- five, so every stored row satisfies the new CHECK by construction and `VALIDATE` cannot
-- fail on existing data. `0055`'s reason for avoiding the split — a skipped second step would
-- leave the constraint unvalidated — is bounded for the same reason: `NOT VALID` excuses only
-- rows that already exist, never a future INSERT, so even an unvalidated constraint still
-- refuses a seventh value. `convalidated` in `pg_constraint` is the readback that proves the
-- second statement landed; `pg_get_constraintdef` prints a trailing `NOT VALID` when it did
-- not.
--
-- MEASURED, so the paragraphs above are not read as a claim about today: the local stack's
-- `bms.notification_deliveries` held 0 rows when this file was written (counted as a
-- BYPASSRLS role — under FORCE ROW LEVEL SECURITY an owner's count reads 0 with rows
-- present). The lock argument is about a pilot host after months of alarms, not about here.
--
-- NO `SET ROLE bms_owner` BRACKET, and that is deliberate rather than an omission. `0055`
-- records the rule and `0065` records the half that bites (a leaked `RESET ROLE`): ownership
-- does not change on `ALTER TABLE`, and `bms.notification_deliveries` is already owned by
-- `bms_owner` — measured in `pg_tables`, as `0065` measured it. Migrations connect as
-- `DATABASE_URL_SUPERUSER` (ADR 0045), which may alter a table it does not own.
--
-- FORWARD-ONLY (§4.4), no down migration, per this repository's convention. A widened CHECK
-- accepts every value the narrow one did, so no stored row can fail it and no rollback of
-- application code is broken by it: an older `apps/api` simply never writes `'skipped_stale'`.
--
-- THE CHECK AND `notificationDeliveryStatusSchema` ARE TWO DECLARATIONS OF ONE VOCABULARY,
-- and drift between them is the `F4.43` failure — a value the contract admits that the
-- database refuses, which typechecks, passes every unit test, and fails for the first time on
-- a production INSERT. `tests/adr-0041-notification-invariants.test.ts` parses the IN list
-- below and compares it as a set to the enum in
-- `packages/shared/src/contracts/notifications.ts`. It reads the NEWEST migration that
-- declares the constraint — this file, until something widens it again — because `0038` is
-- committed and frozen and no longer states the effective vocabulary.

ALTER TABLE bms.notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_status_check;

ALTER TABLE bms.notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
  CHECK (status IN ('sent', 'failed', 'skipped_unconfigured',
                    'skipped_deduped', 'skipped_rate_limited', 'skipped_stale'))
  NOT VALID;

ALTER TABLE bms.notification_deliveries
  VALIDATE CONSTRAINT notification_deliveries_status_check;
