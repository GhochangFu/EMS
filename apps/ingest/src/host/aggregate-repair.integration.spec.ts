import { randomUUID } from "node:crypto";

import { refreshAggregatesFrom } from "@bms/db";
import pg from "pg";
import { expect } from "vitest";

import { createAggregateRepair, createRepairStore } from "./aggregate-repair.js";
import { createHostLogger } from "./logger.js";

/**
 * `E7.2` / ADR 0123 decision 11, plan T3.4 — the repair against real Postgres.
 *
 * 1. The store's SQL: compare-and-clear keeps a window whose bounds or
 *    generation (`backfill_dirty_seq`, migration `0143`) moved, and clears one
 *    that did not, even at a microsecond a JavaScript `Date` cannot hold.
 *    **Nothing commits** — one client, one `BEGIN … ROLLBACK`. The window is
 *    set with `now()`, so it carries microseconds.
 * 2. The plan's case "rows 4 h old → one pass → `_1m` and `_1h` hold the
 *    bucket and the window is NULL" (here 6 h), with `@bms/db`'s real
 *    `refreshAggregatesFrom` as `main.ts` wires it. This one **must commit**:
 *    `refresh_continuous_aggregate` cannot run inside a transaction block. It
 *    owns a per-run gateway code and point key, deletes exactly those, and
 *    re-covers the window after the delete so no materialized row outlives it
 *    (the `0027` obligation).
 *
 * What case 2 proves and what it does not. The window clears only when the
 * refresh resolved, so a clear proves that the pool's role (`bms_fleet`, as
 * in compose) can `SET ROLE bms_rollup` and refresh all four levels over a
 * late window. The aggregate reads are views with `materialized_only = false`,
 * so on a database whose watermark is still behind the fixture's hour they
 * would show the rows through the real-time branch with no refresh at all —
 * the bucket counts are the outcome, the cleared window is the proof.
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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/**
 * `F4.71` (`tests/f4.71-shared-refresh-retry.test.ts`): a fixture's refresh
 * retries a concurrent refresh (`55P03`) with a fixture-sized budget, on top
 * of `refreshAggregatesFrom`'s own request-path retry. A copy of
 * `apps/api/src/testing/cagg-materialize.ts`'s helper, which `apps/ingest`
 * cannot import; it lives in this `.spec` so it stays out of the coverage
 * denominator, as the API's sits outside the code it tests.
 */
async function retryOnConcurrentRefresh<T>(work: () => Promise<T>): Promise<T> {
  const attempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (error: unknown) {
      if ((error as { code?: string } | null)?.code !== "55P03" || attempt >= attempts) throw error;
      await new Promise((done) => setTimeout(done, 3_000));
    }
  }
}

/**
 * A seeded ESKOM asset no other integration suite claims
 * (`tests/integration-fixture-sharing.test.ts`). The point key is per-run, so
 * the simulator's own rows on this asset never meet the fixture's.
 */
const SEEDED_ASSET_CODE = "CR-LIGHT-AUX";

/**
 * A batch 6 h late — behind the `_1m` policy's 3 h reach, so no scheduled job
 * would ever fold it in — is in `_1m` and `_1h` after a repair pass, and its
 * window is cleared. Plan T3.4's integration case, with the wiring of `main.ts`,
 * except that the injected refresh adds the fixture retry above (`F4.71`), so
 * a policy or a sibling suite holding a level's lock does not fail the pass.
 */
export async function assertARepairPassFoldsALateBatchIntoTheAggregates(pool: pg.Pool): Promise<void> {
  const run = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const gatewayCode = `E72-AGG-REPAIR-RUN-${run}`;
  const pointKey = `E72_REPAIR_${run}`;
  const hourStart = Math.floor((Date.now() - 6 * HOUR_MS) / HOUR_MS) * HOUR_MS;
  const times = Array.from({ length: 60 }, (_, k) => new Date(hourStart + k * MINUTE_MS + 7_000));
  const from = times[0];
  const to = times[times.length - 1];

  // Named, never positional (`tests/integration-fixture-isolation.test.ts`); the pool is
  // `bms_fleet`, which holds `BYPASSRLS`, so no organization context is needed.
  const asset = await pool.query<{ id: string }>("SELECT id FROM bms.assets WHERE code = $1", [SEEDED_ASSET_CODE]);
  expect(asset.rows.length, `needs the seeded asset ${SEEDED_ASSET_CODE} — run pnpm db:seed`).toBe(1);
  const org = await pool.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = 'ESKOM'");
  expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
  const assetId = asset.rows[0].id;

  let gatewayId: string | undefined;
  // A cleanup failure must not replace the assertion that failed first.
  let caseFailed = true;
  try {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value)
       SELECT t, $1, $2, v FROM unnest($3::timestamptz[], $4::float8[]) AS s(t, v)`,
      [assetId, pointKey, times, times.map((_, k) => k)],
    );
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO bms.edge_gateways (organization_id, code, name, backfill_dirty_from, backfill_dirty_to)
       VALUES ($1, $2, 'E7.2 aggregate repair run fixture', $3, $4)
       RETURNING id`,
      [org.rows[0].id, gatewayCode, from, to],
    );
    gatewayId = inserted.rows[0].id;

    const lines: string[] = [];
    const repair = createAggregateRepair({
      store: createRepairStore(pool),
      refresh: (windowFrom, windowTo) =>
        retryOnConcurrentRefresh(() => refreshAggregatesFrom(pool, windowFrom, windowTo)),
      now: () => new Date(),
      logger: createHostLogger({}, (line) => lines.push(line)),
      minIntervalMs: 0,
    });
    const windowOf = async () =>
      (
        await pool.query<{ from: Date | null; to: Date | null }>(
          `SELECT backfill_dirty_from AS "from", backfill_dirty_to AS "to" FROM bms.edge_gateways WHERE id = $1`,
          [gatewayId],
        )
      ).rows[0];
    await repair.runOnce();
    expect(await windowOf(), `the window was not cleared; repair log:\n${lines.join("\n")}`).toEqual({
      from: null,
      to: null,
    });

    const minutes = await pool.query<{ n: number; samples: number }>(
      `SELECT count(*)::int AS n, sum(sample_count)::int AS samples FROM telemetry.point_values_1m
        WHERE asset_id = $1 AND point_key = $2 AND bucket >= $3 AND bucket < $4`,
      [assetId, pointKey, new Date(hourStart), new Date(hourStart + HOUR_MS)],
    );
    expect(minutes.rows[0], "_1m must hold one bucket per late minute").toEqual({ n: 60, samples: 60 });
    const hour = await pool.query<{ n: number }>(
      `SELECT sample_count::int AS n FROM telemetry.point_values_1h
        WHERE asset_id = $1 AND point_key = $2 AND bucket = $3`,
      [assetId, pointKey, new Date(hourStart)],
    );
    expect(hour.rows[0]?.n, "_1h must hold the late hour's 60 samples").toBe(60);
    caseFailed = false;
  } finally {
    await pool.query("DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2", [assetId, pointKey]);
    if (gatewayId !== undefined) {
      await pool.query("DELETE FROM bms.edge_gateways WHERE id = $1", [gatewayId]);
    }
    // Re-cover the window after the delete, so no materialized row outlives the case.
    try {
      await retryOnConcurrentRefresh(() => refreshAggregatesFrom(pool, from, to));
    } catch (error) {
      if (!caseFailed) throw error;
      process.stderr.write(`[E7.2] cleanup refresh failed after a failed case: ${String(error)}\n`);
    }
  }
}
