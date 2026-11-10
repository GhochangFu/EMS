import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NOTIFY_LIVE_WINDOW_MS, type UplinkBatch } from "@bms/shared/ingest";
import pg from "pg";
import { expect } from "vitest";

import type { EdgeServed } from "./binding-targets.js";
import {
  asReceived,
  EDGE_DEVICE,
  EDGE_TOKEN,
  type EdgeHarness,
  readings,
  startEdge,
  until,
} from "./edge-roundtrip.spec.js";
import { createHostLogger } from "./logger.js";
import type { PointTarget } from "./normaliser.js";
import { hashToken } from "./uplink-gateways.js";
import { gateway } from "./uplink-gateways.spec.js";
import { createUplinkReceiver, type ReceiverClient } from "./uplink-receiver.js";
import { WRITE_RETRY_AFTER_SECONDS } from "./uplink-server.js";

/**
 * `E7.2` / ADR 0123 decisions 4 and 8, plan T5.8 — the edge round trip with
 * the **real** PR 3 receiver and Postgres: a fake push adapter, the real
 * supervisor, disk buffer and uplink client, the real listener on port 0, the
 * real `createUplinkReceiver` → `resolveSamples` → `writeUplinkRows`. The
 * receiver answers `503` while the database is "down" (its `connect` throws),
 * the edge spills, the receiver recovers, and exactly N rows land at the
 * original `rx`; replaying the same samples from a fresh segment leaves N.
 *
 * **Nothing commits** — the `uplink-write.integration.spec.ts` shape. One
 * client holds one outer `BEGIN … ROLLBACK`; the receiver is handed that
 * client with its `BEGIN` / `COMMIT` / `ROLLBACK` mapped onto a savepoint, so
 * the exact statements run in their order and the outer `ROLLBACK` removes
 * every row and the fixture gateway. A `pg_notify` queued in a rolled-back
 * transaction is never delivered, and with no commit there is nothing to
 * delete and no aggregate to refresh (AGENTS.md §4.4). The edge serialises its
 * posts, so the one client is never used by two writes at once.
 *
 * `point_values.asset_id` has no foreign key, so the rows use one constant
 * synthetic asset id that nothing else in the schema uses.
 */

const FIXTURE_ASSET_ID = "e7200000-0000-4000-8000-0000000000e5";
const FIXTURE_POINT_KEY = "E7_2_EDGE_ROUNDTRIP";
const FIXTURE_CODE = "E72-EDGE-ROUNDTRIP-FIXTURE";

/** The receiver's transaction, as a savepoint inside the suite's own. `release` is the suite's. */
function savepointClient(client: pg.PoolClient): ReceiverClient {
  return {
    async query(text, values) {
      const statement = text.trim();
      if (statement === "BEGIN") return client.query("SAVEPOINT edge_roundtrip");
      if (statement === "COMMIT") return client.query("RELEASE SAVEPOINT edge_roundtrip");
      if (statement === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT edge_roundtrip");
      return values === undefined ? client.query(text) : client.query(text, [...values]);
    },
    release: () => undefined,
  };
}

function target(): PointTarget {
  return {
    assetId: FIXTURE_ASSET_ID,
    pointKey: FIXTURE_POINT_KEY,
    unit: "kW",
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
  };
}

async function fixtureRows(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ time: Date }>(
    `SELECT time FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 ORDER BY time`,
    [FIXTURE_ASSET_ID, FIXTURE_POINT_KEY],
  );
  return rows.map((r) => r.time.toISOString());
}

/**
 * Every sample maps to the one fixture point, each at its own `rx`, so N
 * samples with N distinct receive times are N rows. Samples of one batch share
 * one `rx` and collapse onto one row (ADR 0061 decision 6), so the batches
 * here carry one sample each.
 */
export async function anEdgeOutageLandsEveryRowOnceAtItsOriginalRx(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  const dir = await mkdtemp(join(tmpdir(), "e72-edge-it-"));
  const dir2 = await mkdtemp(join(tmpdir(), "e72-edge-it-replay-"));
  let edge: EdgeHarness | undefined;
  let second: EdgeHarness | undefined;
  try {
    await client.query("BEGIN");
    try {
      const before = await fixtureRows(client);
      expect(before, "the synthetic asset must hold no rows before the suite").toEqual([]);
      const org = await client.query<{ id: string; ingest_enabled: boolean }>(
        "SELECT id, ingest_enabled FROM bms.organizations WHERE code = 'ESKOM'",
      );
      expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
      expect(org.rows[0].ingest_enabled, "the ESKOM organization must have ingest on").toBe(true);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms.edge_gateways (organization_id, code, name, token_hash)
         VALUES ($1, $2, 'E7.2 edge round-trip fixture', $3) RETURNING id`,
        [org.rows[0].id, FIXTURE_CODE, hashToken(EDGE_TOKEN)],
      );
      const gatewayId = inserted.rows[0].id;
      const gw = gateway({ id: gatewayId, organizationId: org.rows[0].id, code: FIXTURE_CODE, tokenHash: hashToken(EDGE_TOKEN) });

      const sourceKeys = ["a0", "b0", "c0", "live0"];
      const edgeServed: EdgeServed = new Map([
        [
          gatewayId,
          {
            deviceKeys: new Set([EDGE_DEVICE]),
            pointIndex: new Map([[EDGE_DEVICE, new Map(sourceKeys.map((k) => [k, [target()]] as const))]]),
          },
        ],
      ]);
      let down = true;
      const attempts: UplinkBatch[] = [];
      let accepted = 0;
      const real = createUplinkReceiver({
        now: () => new Date(),
        edgeServed: () => edgeServed,
        connect: async () => {
          if (down) throw new Error("database down");
          return savepointClient(client);
        },
        liveWindowMs: NOTIFY_LIVE_WINDOW_MS,
        logger: createHostLogger({}, () => undefined),
      });
      const receive: typeof real = async (g, batch, digest) => {
        attempts.push(batch);
        const result = await real(g, batch, digest);
        accepted += result.accepted;
        return result;
      };

      edge = await startEdge({ receive, gateway: gw, dir });
      // Three batches during the outage, each its own receive time.
      for (const prefix of ["a", "b", "c"]) {
        edge.emit(readings(prefix, 1));
        const want = ["a", "b", "c"].indexOf(prefix) + 1;
        await until(() => (edge?.supervisor.health().buffered ?? 0) >= want, `batch ${prefix} on disk`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(edge.supervisor.health().writePath).toBe("buffering");
      const spilledRx = attempts[0]?.samples[0]?.rx;
      expect(spilledRx, "the first batch was posted and answered 503").toBeDefined();

      down = false;
      edge.skew.ms += (WRITE_RETRY_AFTER_SECONDS + 1) * 1000;
      await until(() => edge?.supervisor.health().buffered === 0 && accepted >= 3, "the backlog to drain");
      const rows = await fixtureRows(client);
      expect(rows.length, "exactly one row per buffered sample").toBe(3);
      expect(rows, "a row at the rx the edge stamped before the outage").toContain(spilledRx);

      edge.emit(readings("live", 1));
      await until(() => accepted >= 4, "a live batch after recovery");
      await edge.close();
      edge = undefined;
      expect((await fixtureRows(client)).length).toBe(4);

      // Replay every sample again from a fresh segment: the same keys, so no new row.
      const delivered = attempts.filter((b) => b.samples.length > 0);
      const acceptedBefore = accepted;
      second = await startEdge({ receive, gateway: gw, dir: dir2, preload: asReceived(delivered) });
      await until(() => second?.supervisor.health().buffered === 0 && accepted > acceptedBefore, "the re-replay");
      await second.close();
      second = undefined;
      expect(await fixtureRows(client), "a re-replayed segment upserts the same rows").toHaveLength(4);
    } finally {
      await edge?.close();
      await second?.close();
      await client.query("ROLLBACK");
    }
    expect(await fixtureRows(client), "nothing survived ROLLBACK").toEqual([]);
    const left = await client.query("SELECT 1 FROM bms.edge_gateways WHERE code = $1", [FIXTURE_CODE]);
    expect(left.rows.length, "the fixture gateway survived ROLLBACK").toBe(0);
  } finally {
    client.release();
    await rm(dir, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  }
}
