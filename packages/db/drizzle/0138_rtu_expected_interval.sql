-- F4.350 / ADR 0075 Amendment 3 — how often each RTU is expected to send.
--
--   - `bms.rtus.expected_interval_seconds`: nullable `integer`. When set, the
--     asset freshness window is `clamp(2.5 x this, 25 s, 900 s)` for every
--     asset behind the RTU. NULL = not configured; the API then uses the learned
--     median gap of the RTU's recent samples, and the 25 s floor with none.
--   - CHECK `rtus_expected_interval_seconds_check`: the value is > 0 when set.
--   - No backfill: every RTU starts NULL, so nothing changes until an admin sets
--     a value or PR 2 of F4.350 starts reading the learned gap.
--
-- POLICY. None: the existing `bms.rtus` policies cover a new column.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0131 did. No GRANT: the roles that read `bms.rtus` already hold
-- table-level privileges, which cover the new column.
--
-- Forward-only. Idempotent: the column is `IF NOT EXISTS`; the constraint is
-- added only when `pg_constraint` has no row of that name.

SET ROLE bms_owner;

ALTER TABLE bms.rtus ADD COLUMN IF NOT EXISTS expected_interval_seconds integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rtus_expected_interval_seconds_check'
      AND conrelid = 'bms.rtus'::regclass
  ) THEN
    ALTER TABLE bms.rtus
      ADD CONSTRAINT rtus_expected_interval_seconds_check
      CHECK (expected_interval_seconds IS NULL OR expected_interval_seconds > 0);
  END IF;
END
$$;

RESET ROLE;
