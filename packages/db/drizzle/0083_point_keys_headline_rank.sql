-- F3.68 / ADR 0076 decision 7 — the generated site view's headline order.
--
-- `headline_rank smallint NULL` on `bms.point_keys`: lower shows first on a
-- generated site card; NULL means unranked (plan D1). Ranks are not unique;
-- ties order by point_key ascending, decided in the read, not the schema
-- (plan D4 / OQ4). The CHECK only rejects a non-positive rank; the seeded
-- values (10/20/30/40/50) are written by the seed step, not by this
-- migration (plan D8) - a committed migration is frozen and never carries
-- the seed's own writes.
--
-- `bms.point_keys` is fleet-wide: 0057 dropped its policy and FORCE, 0059
-- revoked tenant UPDATE/DELETE, so this migration adds no policy and no
-- GRANT (0041's default privileges already cover bms_owner-created columns).
--
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (bms_app), so the
-- column and constraint are added as bms_owner inside SET ROLE / RESET ROLE
-- (the 0082_site_control_room_views.sql shape).

SET ROLE bms_owner;

ALTER TABLE bms.point_keys ADD COLUMN IF NOT EXISTS headline_rank smallint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'point_keys_headline_rank_check') THEN
    ALTER TABLE bms.point_keys
      ADD CONSTRAINT point_keys_headline_rank_check CHECK (headline_rank IS NULL OR headline_rank > 0);
  END IF;
END $$;

COMMENT ON COLUMN bms.point_keys.headline_rank IS 'ADR 0076 decision 7: lower shows first on a generated site card; NULL = unranked.';

RESET ROLE;
