-- ADR 0018 — separate the spatial axis from the telemetry-source axis.
--
-- assets.rtu_id was NOT NULL, so an asset could not exist without a gateway.
-- The seed fabricated '{"synthetic":true}' RTU rows to satisfy it: 40 of 52
-- rows on the demo database, of which exactly 1 has ingest_enabled. Meanwhile
-- location_id — the column every scoped authorization check filters on — was
-- nullable, so an asset with no location was silently invisible to every
-- location-scoped user, with no error.
--
-- This inverts both polarities and moves the telemetry source reference down to
-- the point, where one asset can carry several sources. Forward-only, idempotent.

-- 1. The source reference moves to the point.
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS rtu_id uuid REFERENCES bms.rtus(id);

ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS source_kind varchar(16) NOT NULL DEFAULT 'measured';

-- 2. Backfill point-level provenance from the asset's current gateway. Every
--    asset still has one at this point (rtu_id is NOT NULL until step 5), so
--    this leaves no 'measured' row without a source and step 3 cannot fail.
UPDATE bms.asset_points ap
SET rtu_id = a.rtu_id
FROM bms.assets a
WHERE ap.asset_id = a.id
  AND ap.rtu_id IS NULL;

-- 3. A nullable rtu_id alone cannot distinguish "not yet mapped" from "entered
--    by hand" from "derived". source_kind makes the null unambiguous, the way
--    Haystack requires exactly one pointFunction marker on every point.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asset_points_source_kind_check'
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_source_kind_check
      CHECK (source_kind IN ('measured', 'manual', 'computed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'asset_points_source_ref_check'
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_source_ref_check
      CHECK (
        (source_kind = 'measured' AND rtu_id IS NOT NULL)
        OR (source_kind IN ('manual', 'computed') AND rtu_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS asset_points_rtu_idx ON bms.asset_points (rtu_id);

-- 4. Safety backfill before location_id becomes mandatory: an asset with no
--    location inherits its gateway's. Measured 0 such rows on the demo
--    database; this exists so step 5 cannot fail on an older tree. If any row
--    still has no location after this, step 5 fails loudly — which is correct.
--    Silently dropping such an asset is the bug being fixed, not the fix.
UPDATE bms.assets a
SET location_id = r.location_id
FROM bms.rtus r
WHERE a.location_id IS NULL
  AND a.rtu_id = r.id;

-- 5. Invert the polarities. An asset must be somewhere; it need not be wired.
--    NOTE: packages/db/src/hierarchy-seed.ts previously re-applied
--    `rtu_id SET NOT NULL` on every `db:seed`, which would have silently undone
--    this migration on the next seed run. That is removed in the same change.
ALTER TABLE bms.assets ALTER COLUMN location_id SET NOT NULL;
ALTER TABLE bms.assets ALTER COLUMN rtu_id DROP NOT NULL;
