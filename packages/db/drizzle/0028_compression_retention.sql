-- ADR 0024 — telemetry compression and retention (F4.2).
--
-- Compression on telemetry.point_values and the two fine aggregate levels, plus
-- retention on all three. Additive and forward-only.
--
-- Unlike 0027, ALL of this belongs in a migration: ADR 0024 measured fact 2 is
-- that `ALTER TABLE ... SET (timescaledb.compress ...)`,
-- `add_compression_policy()` and `add_retention_policy()` all succeed inside a
-- transaction block AND roll back cleanly (a probe left 0 jobs after ROLLBACK).
-- `refresh_continuous_aggregate()` — the one thing that cannot — is not here.
--
-- `add_compression_policy`, not `add_columnstore_policy`. Both exist on 2.29.1
-- and they are not interchangeable: the former is a FUNCTION, the latter a
-- PROCEDURE (pg_proc.prokind = 'p') needing CALL, which is not what a Drizzle
-- migration emits. TimescaleDB renamed compression to "columnstore" in 2.18 and
-- kept the old name as the alias, so this is a deprecation to watch — the same
-- class as the real-time aggregation ADR 0023 decision 4 depends on.
--
-- WHAT IS DELIBERATELY ABSENT: any compress_chunk() call. Existing chunks older
-- than 7 days are left for each policy's first scheduled run. Whether
-- compress_chunk works inside a transaction is UNMEASURED — fact 2 covers the
-- ALTER and the two policy functions, not that — and this file does not assume it.
--
-- On the dev database that first run compressed two chunks (2026-06-01,
-- 2026-07-01) and retention dropped a third (an empty 2020-01-01 chunk, older
-- than 730 days), so "the old chunks" is not a fixed count — it depends on when
-- the migration is applied and what history is present.
--
-- ============================================================================
-- THE ONE INVARIANT THIS FILE MUST KEEP, and it is not obvious:
--
--   retention(aggregate) > retention(its source)
--
-- Never shorter, and never equal. ADR 0024 facts 13 and 14, measured against
-- 2.29.1 on 2026-08-10:
--
--   Dropping an aggregate's OLD chunks leaves the watermark high, so the dropped
--   range sits BEHIND it and is served from stored rows only — which are gone.
--   A dropped _1m day read 0 rows while raw still held 146,424 rows for it.
--   Silently empty; not a slow fallback to raw.
--
--   AND IT CANNOT BE REBUILT. refresh_continuous_aggregate over exactly that
--   range, with raw complete, reports "already up-to-date" and leaves 0 rows:
--   the range is behind the watermark and the invalidation log is empty. Repair
--   means dropping and recreating the aggregate. No script here does that.
--
-- So the state to make unreachable is "raw HAS period P, its aggregate does
-- NOT". Equal horizons would still produce it transiently, because the two
-- policies run on independent schedules and either may fire first. Hence 735d
-- against raw's 730d: the source always expires first, and the surviving
-- direction (aggregate outlives raw) is the safe one — that is what _1h and _1d
-- do permanently, by ADR 0023 decision 7.
--
-- The five days are margin for scheduling, not a meaningful retention figure.
-- ============================================================================
--
-- Second invariant, with room to spare today but cheap to break:
--
--   compress_after(L) > start_offset(L)   -- L's own refresh policy in 0027
--
-- A refresh writes into buckets inside its start_offset. Compressing sooner than
-- that would make every scheduled run write into a compressed chunk. Raw writes
-- from the ingest into compressed chunks are measured safe (fact 4, including
-- the exact ON CONFLICT ... DO UPDATE); the same for an AGGREGATE refresh is
-- NOT measured, and does not need to be at these margins:
--
--   _1m  start_offset 3 h   vs compress_after 7 d  — 56x
--   _5m  start_offset 12 h  vs compress_after 7 d  — 14x
--
-- Raw is safe by construction: only _1m reads raw, and its start_offset is 3 h.

-- ---------------------------------------------------------------------------
-- Lock bound. ADR 0023 recorded the lock level of its own DDL as UNMEASURED and
-- asked for a pg_locks rehearsal before a pilot run; ADR 0024 fact 16 is that
-- rehearsal, and the answer is worth guarding.
--
-- `ALTER TABLE ... SET (timescaledb.compress ...)` takes an ACCESS EXCLUSIVE lock
-- on telemetry.point_values — the strongest there is, blocking reads as well as
-- writes. Measured 2026-08-10 against the live dev stack, with the simulator and
-- the MQTT ingest both writing.
--
-- The work itself is catalog-only and took 10.7 ms, so duration is not the
-- hazard. ACQUISITION is: the ALTER waits behind every in-flight reader, and
-- while it waits it blocks everyone arriving after it. On a pilot with a
-- long-running dashboard query that turns a 10 ms change into a stall on the hot
-- telemetry path.
--
-- So bound the wait rather than the change. If the lock cannot be had in 5 s this
-- migration fails and rolls back whole and is simply re-run at a quieter moment.
-- A failed retryable migration is a far better outcome than an unbounded stall on
-- live ingest.
--
-- TWO THINGS ABOUT THE SCOPE OF THIS, both verified rather than assumed, because
-- an earlier version of this comment had the first one backwards:
--
-- 1. Drizzle wraps THE WHOLE RUN in one transaction, not each file —
--    drizzle-orm/pg-core/dialect.js opens `session.transaction()` outside the
--    `for await (const migration of migrations)` loop. So `SET LOCAL` reaches
--    every migration applied after this one in the same run. `RESET` at the end of
--    this file is therefore not tidiness; without it the next migration anyone
--    adds silently inherits a 5 s lock_timeout on fresh-database runs (CI, a new
--    dev machine) but not on incremental applies to the pilot — an
--    environment-dependent trap. It is still SET LOCAL rather than SET so nothing
--    escapes the transaction itself.
--
-- 2. `lock_timeout` bounds ACQUISITION only. The ACCESS EXCLUSIVE lock below is
--    held until the transaction COMMITS — that is, until the whole migration run
--    finishes. The 10.7 ms figure is the ALTER's own work, and it is the true
--    blocking window only when this file is applied alone. Applied together with
--    later migrations, the lock is held for the duration of all of them.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Raw: telemetry.point_values
-- ---------------------------------------------------------------------------
-- segmentby is what makes the ratio: grouping each (asset_id, point_key) series
-- lets its values delta-encode against their own neighbours rather than against
-- an interleaved stream. Measured on one real day (425,235 rows): heap 33 MB ->
-- 544 kB (62.1x), total 112 MB -> 3944 kB (29.1x). The two differ because
-- compressing a chunk replaces its btrees, and uncompressed indexes here are
-- 2.4x the heap. A synthetic-value probe managed only 9.6x, so this ratio is a
-- property of real telemetry, not of the settings.
ALTER TABLE telemetry.point_values SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_id, point_key',
  timescaledb.compress_orderby = 'time DESC'
);
--> statement-breakpoint

SELECT add_compression_policy('telemetry.point_values',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE);
--> statement-breakpoint

-- 730 days. The irreversible decision in ADR 0024, taken at the §10 gate. After
-- this, _1h and _1d are the only record of the period, at hourly resolution
-- (ADR 0023 decision 7, which forbids dropping them).
--
-- Nothing can be dropped before 2028: the oldest real row is 2026-08-05. Whether
-- any Ion Exchange compliance obligation needs SAMPLE-LEVEL effluent data beyond
-- two years is a client question, routed to the E5.1 email rather than answered
-- here, and the fuse is long enough that the answer cannot arrive too late.
SELECT add_retention_policy('telemetry.point_values',
  drop_after => INTERVAL '730 days',
  if_not_exists => TRUE);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- point_values_1m and point_values_5m — derivable from raw, so they expire with
-- it (ADR 0024 decision 3: "a level derivable from raw lives exactly as long as
-- raw; a level that outlives raw is never dropped").
--
-- Neither is retained longer for its own sake. Nothing reads _1m older than 47 h
-- or reads _5m at all (fact 11) — but a horizon shorter than raw's would open a
-- window in which raw holds the data, the aggregate returns nothing, and no tool
-- here can repair it. See the invariant block above.
-- ---------------------------------------------------------------------------
ALTER MATERIALIZED VIEW telemetry.point_values_1m SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'asset_id, point_key',
  timescaledb.compress_orderby = 'bucket DESC'
);
--> statement-breakpoint

SELECT add_compression_policy('telemetry.point_values_1m',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('telemetry.point_values_1m',
  drop_after => INTERVAL '735 days',
  if_not_exists => TRUE);
--> statement-breakpoint

ALTER MATERIALIZED VIEW telemetry.point_values_5m SET (
  timescaledb.compress = true,
  timescaledb.compress_segmentby = 'asset_id, point_key',
  timescaledb.compress_orderby = 'bucket DESC'
);
--> statement-breakpoint

SELECT add_compression_policy('telemetry.point_values_5m',
  compress_after => INTERVAL '7 days',
  if_not_exists => TRUE);
--> statement-breakpoint

SELECT add_retention_policy('telemetry.point_values_5m',
  drop_after => INTERVAL '735 days',
  if_not_exists => TRUE);
--> statement-breakpoint

-- Release the lock bound set at the top of this file. Drizzle's transaction spans
-- the whole run, so without this every migration applied after this one in the
-- same run inherits the 5 s timeout. See point 1 in the lock-bound block above.
SET LOCAL lock_timeout = DEFAULT;

-- ---------------------------------------------------------------------------
-- point_values_1h and point_values_1d get NOTHING here, and that is a decision
-- rather than an omission.
--
-- No retention: ADR 0023 decision 7 forbids dropping them, because after raw's
-- 730 days they are the only record. Measured at 0.5% of raw's footprint
-- (~35 MB/yr and ~22 MB/yr against ~11.8 GB/yr), and _1d alone cannot answer
-- "the peak hour in March two years ago" — what ISO 50001 baselining (F4.19) and
-- the E4.x analytics need.
--
-- No compression either, deliberately: together ~60 MB/year, they are the
-- historical report path (the three reports.service.ts sites take an unbounded
-- caller-supplied start and all bucket by hour), and leaving them as row-store
-- keeps that path free of any decompression cost. Two more policies are not
-- worth ~50 MB a year.
-- ---------------------------------------------------------------------------
