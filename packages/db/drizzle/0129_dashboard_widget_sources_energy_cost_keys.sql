-- F4.332 / ADR 0112 Amendment 3 item 1 (and ADR 0070 Amendment 7) — two more catalog entries,
-- the read-time energy cost per local day.
--
-- This migration widens `dashboard_widget_sources_catalog_key_check` to accept
-- `'energy.cost_by_day'` and `'energy.cost.total'`, and does nothing else: no table, column,
-- data, grant or RLS change. It lands with the `metricCatalogKeySchema` members it admits and
-- the resolvers that answer them (`apps/api/src/dashboard-builder/metric-catalog-energy-cost.ts`).
--
-- `0126` IS NOW FROZEN, in its own turn. It widened `0096`'s ten to the thirteen this file's
-- own CHECK still lists before the ADD below runs; from here the EFFECTIVE list is this file's
-- fifteen, the `0079` / `0081` / `0096` / `0126` pattern one generation on.
--
-- WHY A MIGRATION AT ALL. The `IN` list is the database's half of ADR 0048 decision 1 (the
-- catalog is code). A key in the enum without this file passes the contract and the service,
-- then fails at the INSERT. `tests/f3.35-metric-catalog-schema.test.ts` holds the two equal.
--
-- WHY `DROP IF EXISTS` + `ADD`. The constraint already exists with `0126`'s list; an
-- `IF NOT EXISTS` guard would skip the widening and report success. DROP + ADD is idempotent.
--
-- THE LOCK. `ADD CONSTRAINT` validates existing rows under ACCESS EXCLUSIVE on a small
-- configuration table; held for microseconds. Widening is safe in both directions: every value
-- the narrow list accepted the wide one accepts. Forward-only (§4.4).
--
-- NUMBERING. `0128` is taken by the open `F4.330` PR (`0128_organization_ingest_enabled`).
-- Whichever of the two merges second takes the next free number at rebase.
--
-- NO `SET ROLE bms_owner` BRACKET: ownership does not change on `ALTER TABLE`, and the table is
-- already owned by `bms_owner` (`0054`).

ALTER TABLE bms.dashboard_widget_sources
  DROP CONSTRAINT IF EXISTS dashboard_widget_sources_catalog_key_check;

ALTER TABLE bms.dashboard_widget_sources
  ADD CONSTRAINT dashboard_widget_sources_catalog_key_check
  CHECK (catalog_key IN ('alarms.active.count', 'alarms.active', 'workorders.open.count', 'workorders.open', 'assets.health.score', 'sustainability.total', 'sustainability.by_location', 'water.balance', 'assets.offline.count', 'assets.list', 'sites.live.count', 'pue.ratio', 'alarms.critical.count', 'energy.cost_by_day', 'energy.cost.total'));
