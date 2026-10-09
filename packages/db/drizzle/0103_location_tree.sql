-- F2.10 / ADR 0098 decision 1 and Drafter choice 3, with Amendment 1 rulings
-- A1 and A2 — bms.locations becomes a tree of any depth.
--
-- `parent_id` is a nullable uuid with no default: NULL is a root, and every
-- existing row stays a root, so there is no backfill. A child must sit in its
-- parent's organization. That is the composite foreign key
-- `(parent_id, organization_id) -> (id, organization_id)`, which needs the
-- unique `(id, organization_id)` as its target. It is enforced in the same
-- statement whatever the caller can see, so a cross-organization edge fails
-- with SQLSTATE 23503 even on a connection that bypasses row level security.
-- The CHECK refuses a self-parent; the index serves the child lookups.
--
-- The tree-guard trigger refuses what a constraint cannot express: a cycle, a
-- depth above 8 (root = 1; the literal is pinned to `LOCATION_TREE_MAX_DEPTH`
-- in @bms/shared by tests/f2.10-location-tree-migration.test.ts), an active
-- node under an inactive parent, and the deactivation of a node that still has
-- an active child (ADR 0098 decision 5). Each refusal raises SQLSTATE 23514
-- with `CONSTRAINT = 'locations_tree_guard'` and the reason code as the
-- message, so the API maps it to the same 4xx as its own pre-check.
--
-- The trigger is SECURITY INVOKER: it reads `bms.locations` as the caller, so
-- a tenant connection sees only its own organization. A parent row the caller
-- cannot read returns NEW (A1) and the composite foreign key refuses the row
-- in the same statement. The active-children check runs before the parent
-- lookup, so a root's deactivation is refused too (A1).
--
-- Concurrent tree writes inside one organization serialise on the transaction
-- advisory lock `locations_tree:<organization_id>`. The walks read committed
-- state, so the trigger refuses to run a tree check under any other isolation
-- level. A root INSERT has no parent and no children to race on, so it
-- returns before that check (A2): a REPEATABLE READ fixture that writes a root
-- location keeps working.
--
-- Four location types join the vocabulary for the tree's levels: campus,
-- township, building and plant (ADR 0098 decision 2, Drafter choices 4).
--
-- NO POLICY OR PRIVILEGE CHANGE. Row level security on `bms.locations` is
-- table-level and already gates the new column.
--
-- RE-RUNNABLE. The column and the index use IF NOT EXISTS; each ADD CONSTRAINT
-- sits behind a `pg_constraint` probe; the function is CREATE OR REPLACE; the
-- trigger is dropped and created; the types insert does nothing on conflict.
-- The foreign key is added after RESET ROLE, as 0085 placed
-- locations_type_fk. Forward-only, no down migration (AGENTS.md §4.4).
SET ROLE bms_owner;

-- 1. The parent column.
ALTER TABLE bms.locations ADD COLUMN IF NOT EXISTS parent_id uuid;

-- 2. The composite foreign key's target.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_id_organization_key'
      AND conrelid = 'bms.locations'::regclass
  ) THEN
    ALTER TABLE bms.locations
      ADD CONSTRAINT locations_id_organization_key UNIQUE (id, organization_id);
  END IF;
END $$;

-- 3. A location is never its own parent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_parent_not_self_check'
      AND conrelid = 'bms.locations'::regclass
  ) THEN
    ALTER TABLE bms.locations
      ADD CONSTRAINT locations_parent_not_self_check CHECK (parent_id IS DISTINCT FROM id);
  END IF;
END $$;

-- 4. The child lookup: the walks and the active-children check.
CREATE INDEX IF NOT EXISTS locations_organization_id_parent_id_idx
  ON bms.locations (organization_id, parent_id);

-- 5. The tree guard. The order of the body is the contract (ADR 0098
--    Amendment 1, A1 and A2), and tests/f2.10-location-tree-migration.test.ts
--    pins it.
CREATE OR REPLACE FUNCTION bms.locations_tree_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $tree_guard$
DECLARE
  parent_found uuid;
  parent_active boolean;
  is_cycle boolean;
  parent_depth integer;
  node_height integer;
BEGIN
  -- Nothing the tree depends on changed.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
       AND NEW.active IS NOT DISTINCT FROM OLD.active
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A2: a new root has no parent and no children to race on.
  IF TG_OP = 'INSERT' AND NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The walks below read committed state under the lock; a snapshot taken
  -- before the lock would miss a concurrent write the lock just waited for.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'locations_tree_guard requires read committed, not %',
      current_setting('transaction_isolation')
      USING HINT = 'Write a non-root location, or change a location''s parent or active flag, '
        || 'in a READ COMMITTED transaction.';
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('locations_tree:' || NEW.organization_id::text, 0));

  -- A1: before the parent lookup, so a root's deactivation is checked too.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.active AND NOT NEW.active AND EXISTS (
      SELECT 1 FROM bms.locations c
       WHERE c.parent_id = NEW.id
         AND c.organization_id = NEW.organization_id
         AND c.active
    ) THEN
      RAISE EXCEPTION 'location_has_active_children'
        USING ERRCODE = '23514', CONSTRAINT = 'locations_tree_guard',
              DETAIL = 'A location with an active child cannot be deactivated; deactivate its children first.';
    END IF;
  END IF;

  -- A root, or a root whose active flag changed.
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, active INTO parent_found, parent_active
    FROM bms.locations
   WHERE id = NEW.parent_id AND organization_id = NEW.organization_id;

  -- A1: a parent this caller cannot read, or one in another organization.
  -- The composite foreign key refuses the row in the same statement (23503).
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- The parent and its ancestors, nearest first. A self-parent lands here.
  WITH RECURSIVE up (id, organization_id, parent_id, depth) AS (
    SELECT l.id, l.organization_id, l.parent_id, 1
      FROM bms.locations l
     WHERE l.id = NEW.parent_id AND l.organization_id = NEW.organization_id
    UNION
    SELECT l.id, l.organization_id, l.parent_id, up.depth + 1
      FROM bms.locations l
      JOIN up ON l.id = up.parent_id AND l.organization_id = up.organization_id
     WHERE up.depth < 8
  )
  SELECT coalesce(bool_or(up.id = NEW.id), false), max(up.depth)
    INTO is_cycle, parent_depth
    FROM up;

  IF is_cycle THEN
    RAISE EXCEPTION 'location_parent_cycle'
      USING ERRCODE = '23514', CONSTRAINT = 'locations_tree_guard',
            DETAIL = 'A location cannot be placed under itself or under one of its own descendants.';
  END IF;

  -- The node's own height: 1 for a new row, else its deepest descendant.
  IF TG_OP = 'INSERT' THEN
    node_height := 1;
  ELSE
    WITH RECURSIVE down (id, h) AS (
      SELECT NEW.id, 1
      UNION
      SELECT c.id, down.h + 1
        FROM bms.locations c
        JOIN down ON c.parent_id = down.id AND c.organization_id = NEW.organization_id
       WHERE down.h < 8
    )
    SELECT max(down.h) INTO node_height FROM down;
  END IF;

  IF parent_depth IS NULL OR node_height IS NULL OR parent_depth + node_height > 8 THEN
    RAISE EXCEPTION 'location_depth_exceeded'
      USING ERRCODE = '23514', CONSTRAINT = 'locations_tree_guard',
            DETAIL = 'A location tree is at most 8 levels deep.';
  END IF;

  IF NEW.active AND NOT parent_active THEN
    RAISE EXCEPTION 'location_parent_inactive'
      USING ERRCODE = '23514', CONSTRAINT = 'locations_tree_guard',
            DETAIL = 'An active location cannot sit under an inactive parent; reactivate the parent first.';
  END IF;

  RETURN NEW;
END;
$tree_guard$;

DROP TRIGGER IF EXISTS locations_tree_guard ON bms.locations;
CREATE TRIGGER locations_tree_guard
  BEFORE INSERT OR UPDATE OF parent_id, active, organization_id ON bms.locations
  FOR EACH ROW EXECUTE FUNCTION bms.locations_tree_guard();

-- 6. The tree's level types. No conflict target, the 0038 and 0085 reasoning:
--    the bare form covers every unique constraint.
INSERT INTO bms.location_types (code, label, sort_order) VALUES
  ('campus',    'Campus',    50),
  ('township',  'Township',  60),
  ('building',  'Building',  70),
  ('plant',     'Plant',     80)
ON CONFLICT DO NOTHING;

RESET ROLE;

-- 7. The same-organization foreign key, as the migrator's superuser role.
--    ADD CONSTRAINT on a populated table validates every existing row; every
--    row has a NULL parent_id here, so each passes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'locations_parent_id_organization_id_fkey'
      AND conrelid = 'bms.locations'::regclass
  ) THEN
    ALTER TABLE bms.locations
      ADD CONSTRAINT locations_parent_id_organization_id_fkey
      FOREIGN KEY (parent_id, organization_id) REFERENCES bms.locations (id, organization_id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- 8. The proof — the 0059 and 0085 shape. The trigger fires on every write
--    path, and the function runs as its caller with a pinned search_path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'locations_tree_guard'
       AND tgrelid = 'bms.locations'::regclass
       AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'migration 0103: trigger locations_tree_guard is missing or not enabled on bms.locations';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'bms.locations_tree_guard()'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION 'migration 0103: bms.locations_tree_guard() must be SECURITY INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'bms.locations_tree_guard()'::regprocedure
       AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
  ) THEN
    RAISE EXCEPTION 'migration 0103: bms.locations_tree_guard() must pin search_path to pg_catalog, pg_temp';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'bms.locations_tree_guard()'::regprocedure
       AND provolatile = 'v'
  ) THEN
    RAISE EXCEPTION 'migration 0103: bms.locations_tree_guard() must be VOLATILE';
  END IF;
END $$;
