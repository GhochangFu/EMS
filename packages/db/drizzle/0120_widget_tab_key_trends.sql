-- F4.302 / ADR 0108 Amendment 4, owner ruling C (2026-11-02, build review) — a widget follows the
-- `trends` tab that `0119` renamed.
--
-- `0119` renamed a tab keyed `trends` to `trends-<first 8 characters of its id>` but left
-- `bms.dashboard_widgets.config->>'tabKey'` at `trends` on that dashboard. A mimic resolves its tab
-- by `nt.tab_key = w.config->>'tabKey'` (`apps/api/src/dashboard-builder/mimic-nodes.service.ts`),
-- so such a widget lost its tab. This UPDATE moves `tabKey` to the renamed key, in one statement:
--
-- 1. Only a widget whose `config->>'tabKey'` is `trends`. After `0119` no tab can carry that key
--    (the CHECK refuses it), so every such widget names a tab that is gone.
--
-- 2. Only to a tab of the same dashboard whose key is exactly `'trends-' || left(id::text, 8)` —
--    the shape `0119` wrote. A user's own `trends-abcd1234` tab is not matched unless its suffix
--    is its own id prefix, which a hand-typed key is not.
--
-- 3. Only when the dashboard has exactly one tab of that shape (`tab_key` was unique per
--    dashboard, so `0119` renamed at most one); anything else is left for a person to resolve.
--
-- `jsonb_set` keeps every other config key. A second run is a no-op: no widget still names
-- `trends` on a dashboard that was moved. No `SET ROLE` bracket (no object is created) and no down
-- migration (AGENTS.md §4.4, forward-only).

UPDATE bms.dashboard_widgets w
  SET config = jsonb_set(w.config, '{tabKey}', to_jsonb(t.tab_key))
  FROM bms.dashboard_tabs t
  WHERE t.dashboard_id = w.dashboard_id
    AND t.tab_key = 'trends-' || left(t.id::text, 8)
    AND w.config->>'tabKey' = 'trends'
    AND (
      SELECT count(*)
      FROM bms.dashboard_tabs s
      WHERE s.dashboard_id = w.dashboard_id
        AND s.tab_key = 'trends-' || left(s.id::text, 8)
    ) = 1;
