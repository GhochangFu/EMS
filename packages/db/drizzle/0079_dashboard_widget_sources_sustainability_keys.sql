-- E4.2 / ADR 0072 decision 2 — two parameterised catalog entries.
--
-- This migration widens `dashboard_widget_sources_catalog_key_check` to accept
-- `'sustainability.total'` and `'sustainability.by_location'`, and does nothing else. It lands
-- with the `metricCatalogKeySchema` members it admits and the resolver that answers them
-- (`apps/api/src/dashboard-builder/metric-catalog.service.ts`).
--
-- WHY A MIGRATION AT ALL. `0054`'s header says of itself: "`catalog_key` IS A CLOSED
-- VOCABULARY, AND THIS CHECK FREEZES IT" — the `IN` list is the database's half of ADR 0048
-- decision 1 (the catalog is code, and no key reaches the store without a query behind it).
-- A key added to the enum without this file passes the contract, the write schema and the
-- service, then fails at the INSERT with a constraint name in front of an administrator who
-- chose a value the product offered — the drift `tests/f3.35-metric-catalog-schema.test.ts`
-- exists to refuse. `0054` is frozen (the pre-commit hook), so the widening is a new file, in
-- the `0055` / `0050` pattern that admitted `'table'`.
--
-- WHY `DROP IF EXISTS` + `ADD` AND NOT AN `IF NOT EXISTS` GUARD. The constraint ALREADY
-- EXISTS, carrying `0054`'s five-value list. An existence check would find it, conclude there
-- was nothing to do, and skip the widening while reporting a successful migration — a
-- database that refuses every sustainability binding with a green migrate. DROP IF EXISTS
-- followed by ADD is idempotent on its own: a second run drops the widened constraint and
-- re-adds it identically. `0055`'s header records the same reasoning.
--
-- THE LOCK. `ADD CONSTRAINT` on a CHECK validates existing rows under ACCESS EXCLUSIVE.
-- `bms.dashboard_widget_sources` is a configuration table holding at most
-- `WIDGET_SOURCE_CARDINALITY` rows per widget and `MAX_DASHBOARD_WIDGETS` widgets per
-- dashboard, so the scan is trivial and the lock is held for microseconds. No `NOT VALID` +
-- `VALIDATE CONSTRAINT` split.
--
-- WIDENING IS SAFE IN BOTH DIRECTIONS. Every value the narrow list accepted the wide one
-- accepts, so no stored row can fail it and an older `apps/api` simply never writes the two
-- new keys. Forward-only (§4.4); no down migration, per this repository's convention.
--
-- NO `SET ROLE bms_owner` BRACKET, deliberately. Ownership does not change on `ALTER TABLE`,
-- and `bms.dashboard_widget_sources` is already owned by `bms_owner` from `0054`'s own
-- bracket — `0051`, `0053` and `0055` record the same rule.
--
-- THE CHECK AND `metricCatalogKeySchema` ARE TWO DECLARATIONS OF ONE VOCABULARY.
-- `tests/f3.35-metric-catalog-schema.test.ts` parses the IN list below and compares it to the
-- enum parsed out of `packages/shared/src/contracts/dashboard-builder.ts`, so drift fails the
-- build rather than a page; the same file pins `0054`'s frozen five so the two lists cannot be
-- confused.

ALTER TABLE bms.dashboard_widget_sources
  DROP CONSTRAINT IF EXISTS dashboard_widget_sources_catalog_key_check;

ALTER TABLE bms.dashboard_widget_sources
  ADD CONSTRAINT dashboard_widget_sources_catalog_key_check
  CHECK (catalog_key IN ('alarms.active.count', 'alarms.active', 'workorders.open.count', 'workorders.open', 'assets.health.score', 'sustainability.total', 'sustainability.by_location'));
