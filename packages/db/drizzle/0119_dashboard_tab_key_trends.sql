-- F4.302 / ADR 0108 Amendment 4 item 1 — `trends` joins `assets` as a reserved dashboard tab key.
--
-- The site page gains a third section at `/control-room/site/:locationId/trends` (the `F3.72`
-- `assets` shape), so a dashboard tab keyed `trends` would shadow it. Three steps, in order:
--
-- 1. A tab already keyed `trends` is renamed to `trends-<first 8 characters of its id>`. A tab key
--    is unique per dashboard, and the eight characters of a uuid make a collision with a sibling
--    key a one-in-four-billion event; the rename runs first so the widened CHECK cannot fail its
--    validation scan. Before this migration the key was legal, so this is data the CHECK change
--    would otherwise strand.
--
-- 2. `dashboard_tabs_tab_key_check` is dropped (`IF EXISTS`, so a re-run is safe) ...
--
-- 3. ... and added back with `tab_key <> ALL (ARRAY['assets','trends'])`. DROP + ADD, not
--    `IF NOT EXISTS`, because the constraint already exists. No `SET ROLE` bracket (ownership does
--    not change on `ALTER TABLE`) and no down migration (AGENTS.md §4.4, forward-only).
--    `bms.dashboard_tabs` is bounded per dashboard (eight tabs), so the validation scan under the
--    ACCESS EXCLUSIVE lock is trivial.
--
-- THE CHECK AND `RESERVED_DASHBOARD_TAB_KEYS` ARE TWO DECLARATIONS OF ONE LIST. The ARRAY below
-- must equal `RESERVED_DASHBOARD_TAB_KEYS` in `packages/shared/src/contracts/dashboard-tabs.ts`;
-- `tests/f4.302-dashboard-tab-key-trends.test.ts` compares them.

UPDATE bms.dashboard_tabs
  SET tab_key = 'trends-' || left(id::text, 8)
  WHERE tab_key = 'trends';

ALTER TABLE bms.dashboard_tabs
  DROP CONSTRAINT IF EXISTS dashboard_tabs_tab_key_check;

ALTER TABLE bms.dashboard_tabs
  ADD CONSTRAINT dashboard_tabs_tab_key_check
  CHECK (tab_key ~ '^[a-z0-9-]{1,64}$' AND tab_key <> ALL (ARRAY['assets','trends']));
