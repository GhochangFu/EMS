import pg from "pg";
import { expect } from "vitest";

import { createRepairStore } from "./aggregate-repair.js";

/**
 * `E7.2` / ADR 0123 decision 11, plan T3.4 — the repair store's SQL against
 * real Postgres: compare-and-clear keeps a window whose bounds or generation
 * (`backfill_dirty_seq`, migration `0143`) moved, and clears one that did not,
 * even at a microsecond a JavaScript `Date` cannot hold.
 *
 * **The refresh itself is not here.** The plan's case "rows 4 h old → one pass
 * → `_1m` and `_1h` hold the bucket" needs `@bms/db`'s `refreshAggregatesFrom`,
 * and `apps/ingest` does not depend on `@bms/db` yet (plan P8, owed). That
 * case lands with the dependency and the loop's wiring.
 *
 * **Nothing commits** — one client, one `BEGIN … ROLLBACK`. The window is set
 * with `now()`, so it carries microseconds.
 */

const FIXTURE_CODE = "E72-AGG-REPAIR-FIXTURE";

/** A window that moved is kept; the same window unmoved is cleared. */
export async function assertCompareAndClearOnTheRealTable(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const org = await client.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = 'ESKOM'");
      expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms.edge_gateways (organization_id, code, name, backfill_dirty_from, backfill_dirty_to)
         VALUES ($1, $2, 'E7.2 aggregate repair fixture', now() - interval '4 hours', now() - interval '3 hours')
         RETURNING id`,
        [org.rows[0].id, FIXTURE_CODE],
      );
      const id = inserted.rows[0].id;
      const store = createRepairStore(client);

      const listed = (await store.listDirty()).find((w) => w.gatewayId === id);
      expect(listed, "DIRTY_WINDOWS_QUERY did not return the fixture's window").toBeDefined();
      if (listed === undefined) return;

      // A later batch widens the window while the refresh would have run.
      await client.query(
        "UPDATE bms.edge_gateways SET backfill_dirty_from = backfill_dirty_from - interval '1 hour' WHERE id = $1",
        [id],
      );
      expect(await store.clear(listed), "a widened window must not be cleared").toBe(false);
      const kept = await client.query("SELECT backfill_dirty_from FROM bms.edge_gateways WHERE id = $1", [id]);
      expect(kept.rows[0].backfill_dirty_from, "the widened window must survive").not.toBeNull();

      const again = (await store.listDirty()).find((w) => w.gatewayId === id);
      expect(again).toBeDefined();
      if (again === undefined) return;
      // A late batch inside the same bounds moves only the generation (code review 2).
      await client.query(
        "UPDATE bms.edge_gateways SET backfill_dirty_seq = backfill_dirty_seq + 1 WHERE id = $1",
        [id],
      );
      expect(await store.clear(again), "a window whose generation moved must not be cleared").toBe(false);
      const latest = (await store.listDirty()).find((w) => w.gatewayId === id);
      expect(latest).toBeDefined();
      if (latest === undefined) return;
      expect(await store.clear(latest), "an unmoved window must clear, microseconds and all").toBe(true);
      const cleared = await client.query(
        "SELECT backfill_dirty_from, backfill_dirty_to FROM bms.edge_gateways WHERE id = $1",
        [id],
      );
      expect(cleared.rows[0]).toEqual({ backfill_dirty_from: null, backfill_dirty_to: null });
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}
