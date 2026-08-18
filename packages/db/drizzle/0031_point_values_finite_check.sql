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

-- 1. Preflight. DO NOT DELETE THIS AS NOISE: on a compressed hypertable it is
--    the ONLY step that actually reads the data.
--
--    The first version of this file called the preflight an error-message
--    improvement. The migration review measured otherwise, and the measurement
--    is worth keeping because it is counter-intuitive:
--
--      SELECT count(*) FROM ONLY _timescaledb_internal._hyper_1_1_chunk;  -->      0
--      SELECT count(*) FROM      _timescaledb_internal._hyper_1_1_chunk;  --> 146424
--
--    A compressed chunk's own relation is EMPTY -- its rows live in an internal
--    compressed relation -- so `ADD CONSTRAINT`'s validation scan sees nothing
--    there. On this database that is 6 of 17 chunks and 642,358 of 718,879 rows,
--    i.e. the ALTER below validates about 11% of the table and marks the rest
--    valid without looking. The query here reads through decompression and is
--    what actually covers those rows.
--
--    Measured 2026-08-18: 718,879 rows, 0 non-finite -- so this is expected to
--    pass here and exists for deployments this tree has not seen. The column has
--    never been constrained and the only thing keeping it clean is an
--    application in a different repository directory.
--
--    It also fails readably. Without it the ALTER aborts the whole
--    pending-migration transaction with a constraint name and no indication of
--    which rows or how many -- but that is the secondary benefit, not the reason.
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
--    against the live pilot hypertable inside a rolled-back transaction: well
--    under a second over 718,879 rows across 17 chunks.
--
--    **The first version of this comment explained that as TimescaleDB accepting
--    the constraint "without decompressing anything". That was wrong**, and the
--    correction matters more than the timing did: it was fast because the
--    validation scan does not SEE the compressed rows at all (step 1). Do not
--    read the speed as evidence that a large compressed hypertable is cheap to
--    constrain -- the expensive part is the preflight, which does read them.
--
--    NOT VALID + VALIDATE CONSTRAINT would gain nothing HERE, which was checked
--    rather than assumed: drizzle wraps the entire migration run in one
--    transaction, and NOT VALID still takes ACCESS EXCLUSIVE and holds it to
--    commit, so VALIDATE's weaker lock is irrelevant while the stronger one is
--    already held. The split only helps when NOT VALID lands in the migration
--    and VALIDATE runs out of band in a later deploy.
--
--    `lock_timeout` is set because the real hazard is lock ACQUISITION, not the
--    scan. The compression policy (0028) and the aggregate refresh policies
--    (0027) take chunk locks, and a waiting ACCESS EXCLUSIVE queues ahead of
--    every new reader -- so a short wait becomes a stall across the whole ingest
--    and read path. Failing fast is better than blocking the pilot. It is reset
--    afterwards so it does not silently apply to whatever migration is appended
--    next: SET LOCAL lasts to the end of the transaction, and that transaction
--    is the entire run.
--
--    Guarded on pg_constraint so a re-run is a no-op. `conname` is unique per
--    relation rather than globally, so the lookup is qualified by conrelid.
SET LOCAL lock_timeout = '5s';

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

RESET lock_timeout;
