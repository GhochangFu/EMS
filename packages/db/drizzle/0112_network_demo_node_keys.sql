-- F4.263 — a seeded network layout can be saved again.
--
-- WHY. Until F4.263 `seedNetworkDemo` (F3.80, ADR 0101) wrote the node keys of
-- its two layouts with a hyphen (`grid-cb`, `bus-a`, `out-cb-a`, `iso-v1`, ...).
-- `MIMIC_LAYOUT_NODE_KEY` (`^[a-z][a-z0-9_]{0,31}$`) refuses a hyphen, so the
-- `PUT /mimic-layouts/:id` body built from such a layout failed its own parse:
-- the editor save and a copilot `mimicLayout.replace` card could not apply to
-- either seeded layout. The seed now writes underscore keys, but it writes
-- nodes only on the pass that inserted the layout row, so a layout seeded
-- before F4.263 keeps its hyphen keys until this file renames them.
--
-- WHAT. `replace(key, '-', '_')` on `bms.mimic_layout_nodes.key`, for nodes of
-- the two seeded slugs `network-demo-ht-lt` and `network-demo-flow` whose key
-- holds a hyphen, in every organization. Only `seedNetworkDemo` writes those
-- slugs with hyphen keys: the editor and the API cannot create a hyphen key,
-- so any other layout under the same slug already matches and is not touched.
-- The pipes reference nodes by id (`from_node_id`, `to_node_id`) and follow
-- without a write. `version` and `updated_at` do not move: the geometry is
-- unchanged, and a save compares `version` only.
--
-- COLLISION POLICY. A node whose underscore twin already exists in the same
-- layout (`tr-b` beside `tr_b`) is kept as it is, because the rename would
-- break `UNIQUE (layout_id, key)` and stop the migration (and, on the AWS demo,
-- the `migrate` service the api waits on). The NOTICE counts such rows for an
-- operator. The UPDATE and the DO check use the same predicate, so a kept row
-- never fails the migration.
--
-- WHO RUNS WHAT. The UPDATE runs as the migration's own role
-- (`DATABASE_URL_SUPERUSER`, `bms_app`, `rolbypassrls = t`), outside any role
-- bracket — the 0071/0085/0108 rule. The layout tables are `FORCE ROW LEVEL
-- SECURITY` (0047) with `tenant_isolation` on `app.current_organization`, so
-- `bms_owner` with no GUC sees no row and the same statement as that role
-- would report `UPDATE 0` while renaming nothing. No DDL, no privilege change,
-- no policy.
--
-- REPLAY-SAFE. Forward-only and idempotent: once a key holds no hyphen the
-- `LIKE` predicate no longer matches it, so a second run updates nothing, and
-- on a fresh database (migrate runs before seed) it updates zero rows. The
-- `DO $$` block asserts the effect, per the 0059/0085/0108 idiom.

UPDATE bms.mimic_layout_nodes AS n
   SET key = replace(n.key, '-', '_')
  FROM bms.mimic_layouts AS l
 WHERE l.id = n.layout_id
   AND l.slug IN ('network-demo-ht-lt', 'network-demo-flow')
   AND n.key LIKE '%-%'
   AND NOT EXISTS (
     SELECT 1 FROM bms.mimic_layout_nodes AS o
      WHERE o.layout_id = n.layout_id AND o.key = replace(n.key, '-', '_'));

DO $$
DECLARE
  kept integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM bms.mimic_layout_nodes AS n
      JOIN bms.mimic_layouts AS l ON l.id = n.layout_id
     WHERE l.slug IN ('network-demo-ht-lt', 'network-demo-flow')
       AND n.key LIKE '%-%'
       AND NOT EXISTS (
         SELECT 1 FROM bms.mimic_layout_nodes AS o
          WHERE o.layout_id = n.layout_id AND o.key = replace(n.key, '-', '_'))
  ) THEN
    RAISE EXCEPTION 'migration 0112: a network demo node key still holds a hyphen';
  END IF;
  SELECT count(*) INTO kept
    FROM bms.mimic_layout_nodes AS n
    JOIN bms.mimic_layouts AS l ON l.id = n.layout_id
   WHERE l.slug IN ('network-demo-ht-lt', 'network-demo-flow')
     AND n.key LIKE '%-%';
  IF kept > 0 THEN
    RAISE NOTICE 'migration 0112: % node key(s) kept, an underscore twin exists', kept;
  END IF;
END $$;
