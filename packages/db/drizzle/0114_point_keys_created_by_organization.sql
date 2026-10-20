-- F4.111 / ADR 0104 decision 1 -- who added a catalog row.
--
-- `created_by_organization_id uuid NULL` on `bms.point_keys`, referencing
-- `bms.organizations (id)`. Only the onboarding commit sets it, to the
-- session's organization; the seed and the Point keys admin page leave it
-- NULL, and every row from before this migration stays NULL (ADR 0104 drafter
-- choice 3: no backfill). The column counts an organization's additions for
-- the growth quota. It is not a scope: no policy reads it, and ADR 0051
-- decision 3 (every master-data user reads every row) still holds.
--
-- The index serves the quota count, `WHERE created_by_organization_id = $1`.
--
-- `bms.point_keys` is fleet-wide: 0057 dropped its policy and FORCE, 0059
-- revoked tenant UPDATE/DELETE, so this migration adds no policy and no
-- GRANT; bms_tenant's table-level SELECT and INSERT cover the new column
-- (the 0083 shape).
--
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (bms_app), so the
-- column, key and index are added as bms_owner inside SET ROLE / RESET ROLE.
-- RE-RUNNABLE: IF NOT EXISTS and a pg_constraint probe. Forward-only, no down
-- migration (AGENTS.md section 4.4).

SET ROLE bms_owner;

ALTER TABLE bms.point_keys ADD COLUMN IF NOT EXISTS created_by_organization_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'point_keys_created_by_organization_id_fkey') THEN
    ALTER TABLE bms.point_keys
      ADD CONSTRAINT point_keys_created_by_organization_id_fkey
      FOREIGN KEY (created_by_organization_id) REFERENCES bms.organizations (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS point_keys_created_by_organization_id_idx
  ON bms.point_keys (created_by_organization_id);

COMMENT ON COLUMN bms.point_keys.created_by_organization_id IS 'ADR 0104 decision 1: the organization whose onboarding commit added this row; NULL = seeded, admin-added or older than 0114. Counted by the growth quota, never a scope.';

RESET ROLE;
