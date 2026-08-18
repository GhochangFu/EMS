-- F4.32 — move the "telemetry values are finite" guarantee into the database.
--
-- ADR 0026 decision 5 found the guarantee living in **another application**:
-- `apps/ingest/src/host/normaliser.ts:129` and `adapters/mqtt.ts:222` drop
-- non-finite samples before writing, `apps/api` enforces nothing, and this
-- column carried no CHECK at all. So any direct writer -- psql, a future
-- adapter, a bulk import -- could store 'NaN'::float8. That ADR named the fix
-- and deferred it here rather than leaving it in a paragraph.
--
-- Why it matters, recorded rather than assumed harmless: `csvNumberCell` throws
-- on a non-finite value, so one such row makes /reports/energy/export.csv a
-- PERSISTENT 500 for every range covering that bucket, while
-- /reports/energy/preview returns "totalKwh": null on the same data
-- (JSON.stringify(NaN) is null). And once the bucket is absorbed into a
-- continuous aggregate, deleting the raw row does NOT repair it (AGENTS.md 4.4).
--
-- ============================================================================
-- THE CONSTRAINT IS NOT THE ONE F4.32 PRESCRIBED, AND THAT IS THE POINT.
-- ============================================================================
--
-- The row asked for `CHECK (value = value)` -- the classic NaN guard, which
-- works because IEEE 754 says NaN != NaN. **PostgreSQL deliberately does not
-- implement that.** To let float8 be sorted and used in tree indexes, Postgres
-- defines NaN as equal to itself and greater than every non-NaN value. So
-- `value = value` is TRUE for NaN and the prescribed constraint is a NO-OP.
--
-- Measured on this database before writing, not reasoned about:
--
--   SELECT 'NaN'::float8 = 'NaN'::float8;              -- t
--   CREATE TEMP TABLE t (v float8 CHECK (v = v));
--   INSERT INTO t VALUES ('NaN');                      -- INSERT 0 1
--
-- The range form below rejects NaN *because* of that same ordering rule -- NaN
-- sorts above 'Infinity', so `value < 'Infinity'` is false for it -- and it also
-- rejects both infinities, which `value = value` never would. That matches the
-- guarantee the ingest normaliser actually provides, which is *finite*, not
-- merely *not-NaN*. Verified in all three directions: 42.5 accepted, 'NaN'
-- rejected, 'Infinity' rejected.
--
-- Forward-only and idempotent.

-- 1. Preflight: name the offending rows rather than failing on a bare 23514.
--
--    Measured 2026-08-18: 718,879 rows, 0 non-finite -- so this is expected to
--    pass here and exists for deployments this tree has not seen. The column has
--    never been constrained and the only thing keeping it clean is an
--    application in a different repository directory.
--
--    Without it, the ALTER below aborts the whole pending-migration transaction
--    with a constraint name and no indication of which rows or how many.
DO $$
DECLARE
  offenders bigint;
  first_bad text;
BEGIN
  SELECT count(*) INTO offenders
    FROM telemetry.point_values
   WHERE NOT (value > '-Infinity'::float8 AND value < 'Infinity'::float8);

  IF offenders > 0 THEN
    SELECT format('asset_id=%s point_key=%s time=%s', asset_id, point_key, "time")
      INTO first_bad
      FROM telemetry.point_values
     WHERE NOT (value > '-Infinity'::float8 AND value < 'Infinity'::float8)
     ORDER BY "time"
     LIMIT 1;

    RAISE EXCEPTION
      'F4.32: telemetry.point_values holds % row(s) whose value is not finite (NaN or +/-Infinity). Earliest: %. Delete or correct them, then re-run. Note that deleting a raw row does NOT repair a continuous aggregate that already absorbed it -- refresh the affected range per AGENTS.md 4.4.',
      offenders, first_bad;
  END IF;
END $$;

-- 2. The constraint.
--
--    Reject rather than coerce, which is the open question F4.32 recorded.
--    Coercion has nowhere to go: `value` is NOT NULL, so a non-finite sample
--    cannot become NULL, and silently substituting a number would invent a
--    reading -- the opposite of what a telemetry store should do. The ingest
--    normaliser already drops these upstream; this is the backstop for every
--    writer that does not go through it.
--
--    ADD CONSTRAINT validates existing rows and takes ACCESS EXCLUSIVE. Measured
--    on the pilot hypertable -- 718,879 rows across 17 chunks, **6 of them
--    compressed** -- it completed in well under a second, and TimescaleDB
--    accepted it without decompressing anything. That was tested against the
--    live table inside a transaction and rolled back, because "a forward-only
--    migration on a populated hypertable is not free" is exactly the kind of
--    claim that should be measured before it is believed.
--
--    Guarded on pg_constraint so a re-run is a no-op. `conname` is unique per
--    relation rather than globally, so the lookup is qualified by conrelid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'point_values_value_finite_check'
      AND conrelid = 'telemetry.point_values'::regclass
  ) THEN
    ALTER TABLE telemetry.point_values
      ADD CONSTRAINT point_values_value_finite_check
      CHECK (value > '-Infinity'::float8 AND value < 'Infinity'::float8);
  END IF;
END $$;
