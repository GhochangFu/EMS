-- E7.2 / ADR 0123 decision 11 - bms.edge_gateways.backfill_dirty_seq, the dirty
-- window's generation counter. Found by the PR 3 code review (finding 2), after
-- 0141 was committed, so it ships forward-only here.
--
-- WHY. The aggregate repair pass refreshes a gateway's dirty window and then
-- clears it with a compare-and-clear on (backfill_dirty_from, backfill_dirty_to),
-- so a window a later batch WIDENED while the refresh ran survives. A later
-- batch whose late rows fall INSIDE the unchanged window moves neither bound:
-- the compare matches, the window is cleared, and rows the refresh may already
-- have passed over are never folded into the aggregates. The receiver now bumps
-- this counter for every batch that carries a late row, widening or not, and
-- the repair pass clears only the generation it read.
--
-- bigint NOT NULL DEFAULT 0: existing rows read 0 and nothing is rewritten by
-- hand. On PostgreSQL 11+ a constant default is a catalog-only change, so the
-- ACCESS EXCLUSIVE lock is brief; it is still bounded, the 0069 / 0070 / 0071
-- idiom, because the receiver updates this table on every batch: five seconds,
-- then fail and be re-run, rather than queue every uplink write behind it.
--
-- WHY THIS FILE WRITES NO GRANT. A new column inherits the table's privileges,
-- and bms_fleet's SELECT and UPDATE on bms.edge_gateways arrived through 0041's
-- default privileges (0141's proof asserts them). The column is added as
-- bms_owner, the table's owner, hence the bracket.
--
-- pnpm db:migrate connects as DATABASE_URL_SUPERUSER (bms_app). Forward-only and
-- idempotent: ADD COLUMN IF NOT EXISTS. No statement-breakpoint markers (the
-- 0038 reason).

SET LOCAL lock_timeout = '5s';

SET ROLE bms_owner;

ALTER TABLE bms.edge_gateways ADD COLUMN IF NOT EXISTS backfill_dirty_seq bigint NOT NULL DEFAULT 0;

RESET ROLE;

RESET lock_timeout;

-- The proof, as the migrator's own role: a column of another type, nullable, or
-- with no default would read correct above and break the repair's compare.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'bms'
       AND table_name = 'edge_gateways'
       AND column_name = 'backfill_dirty_seq'
       AND data_type = 'bigint'
       AND is_nullable = 'NO'
       AND column_default IN ('0', '0::bigint')
  ) THEN
    RAISE EXCEPTION 'migration 0143: bms.edge_gateways.backfill_dirty_seq is missing, or not bigint NOT NULL DEFAULT 0';
  END IF;

  IF NOT has_column_privilege('bms_fleet', 'bms.edge_gateways', 'backfill_dirty_seq', 'UPDATE') THEN
    RAISE EXCEPTION 'migration 0143: bms_fleet cannot UPDATE bms.edge_gateways.backfill_dirty_seq';
  END IF;
END $$;
