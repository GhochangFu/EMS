import { errorKind, type HostLogger } from "./logger.js";

/**
 * The cloud host's aggregate repair (`E7.2`, ADR 0123 decision 11, plan T3.4,
 * C7 and M11).
 *
 * A row the uplink receiver writes more than 2 h late is behind the `_1m`
 * refresh policy's reach, so no scheduled job ever folds it into the
 * continuous aggregates. The receiver records the span of such rows on the
 * gateway (`backfill_dirty_from` / `_to`, in the same transaction as the
 * rows); this module refreshes each recorded window and clears it **only on
 * success**, so a host that crashes between write and refresh finds the
 * window again on restart.
 *
 * **Compare-and-clear.** The clear names the exact window and generation it
 * refreshed (`WHERE … backfill_dirty_from = $2 AND backfill_dirty_to = $3 AND
 * backfill_dirty_seq = $4`). A later batch that widened the window moves a
 * bound; one whose late rows fell **inside** it moves only
 * `backfill_dirty_seq` (migration `0143`, code review 2). Either way the
 * clear no longer matches and the window survives for the next pass. The keys
 * are the columns' own text, read in the same query, so a microsecond the
 * JavaScript `Date` cannot hold can never make a window un-clearable.
 *
 * **At most one pass a minute per gateway**, and never two passes at once:
 * `refreshAggregatesFrom` takes `bms_rollup` locks and retries `55P03` only
 * twice (M11), so a host that hammered it would fail more refreshes, not
 * fewer.
 *
 * **The refresh is injected** (`refresh(from, to)`): `main.ts` will pass
 * `@bms/db`'s `refreshAggregatesFrom` over the host's pool once
 * `apps/ingest/package.json` depends on `@bms/db` (plan P8, owed; see
 * `docs/ingest-host.md` *The uplink receiver*). Until then the loop is not
 * started and windows accumulate on the gateway rows — durable, so nothing is
 * lost, only not yet repaired.
 */

/** One gateway's recorded window. `fromKey`/`toKey` are the stored values as text. */
export type DirtyWindow = {
  readonly gatewayId: string;
  readonly from: Date;
  readonly to: Date;
  readonly fromKey: string;
  readonly toKey: string;
  /** `backfill_dirty_seq` as text: the generation this pass read. */
  readonly seqKey: string;
};

/** Where windows are read and cleared. `clear` resolves `false` when the window moved. */
export type RepairStore = {
  listDirty(): Promise<readonly DirtyWindow[]>;
  clear(window: DirtyWindow): Promise<boolean>;
};

/** Every gateway with a recorded window, oldest window first. */
export const DIRTY_WINDOWS_QUERY = `
  SELECT id,
         backfill_dirty_from,
         backfill_dirty_to,
         backfill_dirty_from::text AS from_key,
         backfill_dirty_to::text AS to_key,
         backfill_dirty_seq::text AS seq_key
    FROM bms.edge_gateways
   WHERE backfill_dirty_from IS NOT NULL
     AND backfill_dirty_to IS NOT NULL
   ORDER BY backfill_dirty_from, id
`;

/** Clears one gateway's window only if it is still exactly the one refreshed. */
export const CLEAR_DIRTY_WINDOW = `
  UPDATE bms.edge_gateways
     SET backfill_dirty_from = NULL,
         backfill_dirty_to = NULL,
         updated_at = now()
   WHERE id = $1
     AND backfill_dirty_from = $2::timestamptz
     AND backfill_dirty_to = $3::timestamptz
     AND backfill_dirty_seq = $4::bigint
`;

/** The slice of a `pg` pool or client the store needs. */
export type RepairQueryable = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount: number | null }>;
};

/** The SQL half of the store, over the host's pool. Every write filters by gateway id. */
export function createRepairStore(db: RepairQueryable): RepairStore {
  return {
    async listDirty() {
      const { rows } = await db.query(DIRTY_WINDOWS_QUERY);
      const windows: DirtyWindow[] = [];
      for (const row of rows) {
        if (row.backfill_dirty_from instanceof Date && row.backfill_dirty_to instanceof Date) {
          windows.push({
            gatewayId: String(row.id),
            from: row.backfill_dirty_from,
            to: row.backfill_dirty_to,
            fromKey: String(row.from_key),
            toKey: String(row.to_key),
            seqKey: String(row.seq_key),
          });
        }
      }
      return windows;
    },
    async clear(window) {
      const result = await db.query(CLEAR_DIRTY_WINDOW, [window.gatewayId, window.fromKey, window.toKey, window.seqKey]);
      return result.rowCount === 1;
    },
  };
}

/** Minimum time between two passes over the same gateway. */
export const REPAIR_MIN_INTERVAL_MS = 60_000;

export type AggregateRepairDeps = {
  readonly store: RepairStore;
  /** `refreshAggregatesFrom(pool, from, to)` from `@bms/db`, once wired. */
  readonly refresh: (from: Date, to: Date) => Promise<void>;
  readonly now: () => Date;
  readonly logger: HostLogger;
  readonly minIntervalMs?: number;
};

export type AggregateRepair = {
  /** One pass over every recorded window. Never rejects: every failure is one log line. */
  runOnce(): Promise<void>;
};

/** Builds the repair pass. The caller owns the timer (`main.ts`, once wired). */
export function createAggregateRepair(deps: AggregateRepairDeps): AggregateRepair {
  const minIntervalMs = deps.minIntervalMs ?? REPAIR_MIN_INTERVAL_MS;
  const lastPass = new Map<string, number>();
  let running = false;

  async function repairOne(window: DirtyWindow): Promise<void> {
    try {
      await deps.refresh(window.from, window.to);
    } catch (error) {
      // The window stays: it is cleared only on success, so the next pass retries it.
      deps.logger.warn("aggregate repair failed; window kept", { gatewayId: window.gatewayId, ...errorKind(error) });
      return;
    }
    const cleared = await deps.store.clear(window);
    if (cleared) {
      deps.logger.info("aggregate window repaired", {
        gatewayId: window.gatewayId,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
      });
    } else {
      deps.logger.info("dirty window moved during refresh; kept for the next pass", {
        gatewayId: window.gatewayId,
      });
    }
  }

  return {
    async runOnce() {
      if (running) {
        return;
      }
      running = true;
      try {
        const windows = await deps.store.listDirty();
        for (const window of windows) {
          const nowMs = deps.now().getTime();
          const last = lastPass.get(window.gatewayId);
          if (last !== undefined && nowMs - last < minIntervalMs) {
            continue;
          }
          lastPass.set(window.gatewayId, nowMs);
          await repairOne(window);
        }
      } catch (error) {
        deps.logger.error("aggregate repair pass failed", errorKind(error));
      } finally {
        running = false;
      }
    },
  };
}
