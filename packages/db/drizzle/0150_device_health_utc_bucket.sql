-- F3.16 (ADR 0127 decision 3): the whole-hour bucket checks compare in UTC.
--
-- 0149 wrote `CHECK (bucket = date_trunc('hour', bucket))`. date_trunc on a
-- timestamptz follows the session time zone, so under a half-hour zone such as
-- Asia/Kolkata every whole UTC hour failed the check. The ingest writer sets
-- UTC itself, but no reader or later writer should depend on that. Forward-only:
-- replace both constraints with the three-argument form, which truncates in UTC
-- whatever the session's zone. Idempotent: each constraint is dropped if present
-- and re-added. The tables are empty or hold whole UTC hours only, so the new
-- check validates without rewriting a row.

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

ALTER TABLE bms.rtu_drop_hours DROP CONSTRAINT IF EXISTS rtu_drop_hours_bucket_check;
ALTER TABLE bms.rtu_drop_hours
  ADD CONSTRAINT rtu_drop_hours_bucket_check CHECK (bucket = date_trunc('hour', bucket, 'UTC'));

ALTER TABLE bms.ingest_endpoint_drop_hours DROP CONSTRAINT IF EXISTS ingest_endpoint_drop_hours_bucket_check;
ALTER TABLE bms.ingest_endpoint_drop_hours
  ADD CONSTRAINT ingest_endpoint_drop_hours_bucket_check CHECK (bucket = date_trunc('hour', bucket, 'UTC'));

RESET ROLE;

RESET lock_timeout;
