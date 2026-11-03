-- F4.304 / ADR 0108 Amendment 5 item 1 — a location can carry a floor area.
--
-- One nullable column, `bms.locations.floor_area_m2 numeric(12,2)`, always in square metres (the
-- admin form and the onboarding draft accept m2 or ft2 and convert before the write). NULL means
-- "no area": it is never a zero and never a rank. numeric(12,2) holds up to 9 999 999 999.99.
--
-- The CHECK refuses zero, a negative and NaN. A bare `floor_area_m2 > 0` would admit NaN, because
-- Postgres orders NaN above every other numeric (the migration 0064 lesson), so the NaN leg is
-- explicit. Infinity is refused by numeric(12,2) itself (SQLSTATE 22003). A NULL passes a CHECK.
-- The drizzle column in `packages/db/src/schema/bms-schema.ts` mirrors this definition.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the constraint is dropped and re-added, so a second run is
-- a no-op. The ADD CONSTRAINT takes no IF NOT EXISTS (Postgres has none). Forward-only: no down
-- file. No `SET ROLE` bracket, no DEFAULT and no NOT NULL (existing rows stay NULL). Grants, RLS
-- and the tenant trigger on bms.locations are unchanged.
ALTER TABLE bms.locations ADD COLUMN IF NOT EXISTS floor_area_m2 numeric(12,2);
ALTER TABLE bms.locations DROP CONSTRAINT IF EXISTS locations_floor_area_m2_check;
ALTER TABLE bms.locations ADD CONSTRAINT locations_floor_area_m2_check CHECK (floor_area_m2 > 0 AND floor_area_m2 <> 'NaN'::numeric);
