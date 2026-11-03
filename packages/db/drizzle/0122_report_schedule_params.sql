-- F4.303 / ADR 0108 Amendment 6 item 7 — a report schedule can carry parameters.
--
-- One nullable column, `bms.report_schedules.params jsonb`. It holds `{ compare }` for an
-- `energy_consumption` schedule and `{ points, compare }` for a `trend_points` schedule. NULL means
-- "no parameters": every schedule that exists today, and an `energy_consumption` schedule with
-- compare off. The API's Zod schema (`reportScheduleParamsSchema`) is the single point that owns the
-- shape, so the database holds only the one structural rule below. There is no `template_id` CHECK
-- either (the `0077` / `0078` reasoning: the API's literal schema would otherwise need to grow in
-- two places).
--
-- The CHECK refuses a JSON array, number, string, boolean and `null` literal. A SQL NULL passes a
-- CHECK. `jsonb_typeof('null'::jsonb)` is 'null', so the JSON `null` literal is refused too.
-- The drizzle column in `packages/db/src/schema/report-schedules-schema.ts` mirrors the column;
-- the CHECK is not mirrored there (the file's convention).
--
-- `SET ROLE bms_owner` is the `0078` bracket: the migrator connects as the superuser and the table
-- is owned by `bms_owner`, so the ALTERs run as the owner. `RESET ROLE` is mandatory: a leaked SET
-- ROLE reaches the drizzle migrator's own journal write. Idempotent: ADD COLUMN IF NOT EXISTS; the
-- constraint is dropped and re-added, so a second run is a no-op (the ADD CONSTRAINT takes no
-- IF NOT EXISTS, Postgres has none). Forward-only: no down file. No DEFAULT and no NOT NULL
-- (existing rows stay NULL). Grants and RLS on the table are unchanged; it has no trigger.
SET ROLE bms_owner;

ALTER TABLE bms.report_schedules ADD COLUMN IF NOT EXISTS params jsonb;
ALTER TABLE bms.report_schedules DROP CONSTRAINT IF EXISTS report_schedules_params_object_check;
ALTER TABLE bms.report_schedules ADD CONSTRAINT report_schedules_params_object_check CHECK (params IS NULL OR jsonb_typeof(params) = 'object');

RESET ROLE;
