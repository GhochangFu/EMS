-- F3.46 / ADR 0041 Amendment 2 — `dedupe_key`'s first reader gets its index.
--
-- WHY NOW. 0038:157-164 left `notification_deliveries.dedupe_key` unindexed on
-- purpose — "there is deliberately NO index on it, since an index with no
-- reader costs a write on every row and buys nothing. Whoever gives it a
-- reader adds the index with it." `NotificationsService.hasRecordedSkip`
-- (`notifications.service.ts`) is that reader, added by `F3.46` Unit A: it
-- checks `(channel_id, organization_id, dedupe_key, status = 'skipped_deduped')`
-- once per refusal, before deciding whether to record a second row under the
-- same key. This migration is the promised discharge, not a new decision
-- (ADR 0041 Amendment 2, Q2).
--
-- WHY PARTIAL, ON status = 'skipped_deduped'. `hasRecordedSkip` only ever asks
-- about that one status (D4 of `docs/plans/f3.46-dedupe-skip-growth.md`); a
-- `sent` or `failed` row can never satisfy its query. A partial index over
-- just the skip rows is maintained only on the writes that need it — the
-- smallest population after Unit A's once-per-key suppression — and costs
-- `sent`/`failed` inserts nothing.
--
-- WHY organization_id IS NOT IN THE KEY. The rule id is embedded inside
-- `dedupe_key` itself and a rule belongs to exactly one organization, so
-- `(channel_id, dedupe_key)` already narrows to at most a handful of rows;
-- the heap filter on `organization_id` that `hasRecordedSkip` still applies
-- touches only the concurrent-sweep duplicates D3 accepts as a bound, not an
-- invariant. A full `(channel_id, dedupe_key)` index (no predicate) would
-- also serve a future `F3.10` (escalation) reader over `sent` rows by key;
-- per 0038's own rule, that reader adds its own index when it exists.
--
-- WHY NO CONCURRENTLY. ADR 0045 / AGENTS.md §4.4: drizzle applies every
-- migration file inside one transaction, and `CREATE INDEX CONCURRENTLY`
-- cannot run inside one (`tests/e7.1i-audit-log-index.test.ts` asserts the
-- same absence for its own index). Forward-only and idempotent
-- (`IF NOT EXISTS`); the table has 0 rows in every measured environment
-- (§2 of the plan), so an ordinary `CREATE INDEX` costs nothing to run.
--
-- ADR 0045 / AGENTS.md §4.4 — THE `SET ROLE bms_owner` / `RESET ROLE`
-- BRACKET. `bms_owner` owns `bms.notification_deliveries` (measured), and
-- `CREATE INDEX` on a table the role owns is an ordinary write the owner may
-- make — no cross-role `ALTER ... OWNER TO` and no role-membership `GRANT`,
-- so the connecting superuser is not needed. `RESET ROLE` is the half that
-- bites: a forgotten one leaks past `COMMIT` into the session, so drizzle's
-- own journal `INSERT` and every later file in the same run would execute as
-- `bms_owner`, which holds no grant on the `drizzle` schema.
--
-- Forward-only and idempotent. Indexed 0065: 0056-0064 are committed and
-- frozen, and the journal `when` is strictly greater than 0064's
-- 1788701172268, or drizzle applies nothing and every check downstream
-- passes against a schema short one index (`0024`'s header records this).

SET ROLE bms_owner;

CREATE INDEX IF NOT EXISTS notification_deliveries_dedupe_skip_idx
  ON bms.notification_deliveries (channel_id, dedupe_key)
  WHERE status = 'skipped_deduped';

RESET ROLE;
