import { NOTIFY_LIVE_WINDOW_MS } from "@bms/shared/ingest";
import pg from "pg";
import { expect } from "vitest";

import type { PointValueRow, QueryableClient } from "./normaliser.js";
import { hashToken } from "./uplink-gateways.js";
import { writeUplinkRows } from "./uplink-write.js";

/**
 * `E7.2` / ADR 0123 decisions 8 and 11, plan T3.3 — the receiver's write
 * against real Postgres: the upsert is idempotent on a retried batch, and the
 * gateway's dirty window is set, widened and left alone by the real SQL.
 *
 * **Nothing commits** — the `normaliser.integration.spec.ts` shape, one client
 * and one outer `BEGIN … ROLLBACK`. `writeUplinkRows` opens and commits its
 * own transaction, so the client it is handed maps its `BEGIN` / `COMMIT` /
 * `ROLLBACK` onto a savepoint inside the outer transaction: the exact
 * statements run, in their order, and the outer `ROLLBACK` removes every row
 * and the fixture gateway. A `pg_notify` queued inside a transaction that
 * rolls back is never delivered, so no listener sees a fixture reading.
 *
 * Because nothing commits, nothing is materialised, so there is no aggregate
 * to repair after (AGENTS.md §4.4's delete-then-refresh rule has no delete to
 * follow). `point_values.asset_id` has no foreign key, so the rows use one
 * constant synthetic asset id. The late rows are 4–5 h old, inside raw's
 * uncompressed chunks (compression starts at 7 days).
 */

/** Synthetic; nothing else in the schema uses it. */
const FIXTURE_ASSET_ID = "e7200000-0000-4000-8000-000000000072";
const FIXTURE_POINT_KEY = "E7_2_UPLINK_FIXTURE";
const FIXTURE_CODE = "E72-UPLINK-WRITE-FIXTURE";
const HOUR = 3_600_000;
/** The fixture gateway's token; the write binds its commit to this digest (security review M1). */
const FIXTURE_DIGEST = hashToken(`bmsgw_${"E72uplinkWrite".padEnd(43, "w")}`);
const OTHER_DIGEST = hashToken(`bmsgw_${"E72uplinkRotated".padEnd(43, "r")}`);

/** `writeUplinkRows`'s transaction, as a savepoint inside the suite's own. */
function savepointClient(client: pg.PoolClient): QueryableClient {
  return {
    async query(text, values) {
      const statement = text.trim();
      if (statement === "BEGIN") return client.query("SAVEPOINT uplink_write");
      if (statement === "COMMIT") return client.query("RELEASE SAVEPOINT uplink_write");
      if (statement === "ROLLBACK") return client.query("ROLLBACK TO SAVEPOINT uplink_write");
      return values === undefined ? client.query(text) : client.query(text, [...values]);
    },
  };
}

function row(time: Date, value = 1): PointValueRow {
  return { time, assetId: FIXTURE_ASSET_ID, pointKey: FIXTURE_POINT_KEY, value, unit: "kW", deviceTime: null };
}

type GatewayState = {
  readonly backfill_dirty_from: Date | null;
  readonly backfill_dirty_to: Date | null;
  readonly last_seen_at: Date | null;
  readonly reported_backlog: number | null;
  readonly clock_state: string | null;
};

async function gatewayState(client: pg.PoolClient, id: string): Promise<GatewayState> {
  const { rows } = await client.query<GatewayState>(
    `SELECT backfill_dirty_from, backfill_dirty_to, last_seen_at, reported_backlog, clock_state
       FROM bms.edge_gateways WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function fixtureRowCount(client: pg.PoolClient, floor: Date): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM telemetry.point_values
      WHERE asset_id = $1 AND point_key = $2 AND time >= $3`,
    [FIXTURE_ASSET_ID, FIXTURE_POINT_KEY, floor],
  );
  return rows[0].n;
}

/** Runs `body` inside one rolled-back transaction with a fresh active fixture gateway. */
async function withFixtureGateway(
  pool: pg.Pool,
  body: (client: pg.PoolClient, gatewayId: string) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const org = await client.query<{ id: string; ingest_enabled: boolean }>(
        "SELECT id, ingest_enabled FROM bms.organizations WHERE code = 'ESKOM'",
      );
      expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
      expect(
        org.rows[0].ingest_enabled,
        "the seeded ESKOM organization must have ingest on (ADR 0115 default): the write requires it",
      ).toBe(true);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO bms.edge_gateways (organization_id, code, name, token_hash)
         VALUES ($1, $2, 'E7.2 uplink write fixture', $3) RETURNING id`,
        [org.rows[0].id, FIXTURE_CODE, FIXTURE_DIGEST],
      );
      await body(client, inserted.rows[0].id);
    } finally {
      await client.query("ROLLBACK");
    }
    const left = await client.query("SELECT 1 FROM bms.edge_gateways WHERE code = $1", [FIXTURE_CODE]);
    expect(left.rows.length, "the fixture gateway survived ROLLBACK").toBe(0);
  } finally {
    client.release();
  }
}

function optionsFor(gatewayId: string, now: Date, buffered = 0, tokenDigest = FIXTURE_DIGEST) {
  return {
    now,
    liveWindowMs: NOTIFY_LIVE_WINDOW_MS,
    report: { gatewayId, buffered, clock: "synced" as const, tokenDigest },
  };
}

/**
 * The same rows twice leave the same row count: `time` is the key (decision 8).
 * **Proves the upsert only** — the rows are handed in resolved, so the wire's
 * `rx` becoming `time` is `uplink-receiver-screen.spec.ts`'s claim, not this.
 */
export async function assertARetriedBatchIsIdempotent(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    const now = new Date();
    const floor = new Date(now.getTime() - 6 * HOUR);
    const rows = [row(new Date(now.getTime() - 1_000), 1), row(new Date(now.getTime() - 4 * HOUR), 2)];
    await writeUplinkRows(savepointClient(client), rows, optionsFor(gatewayId, now));
    expect(await fixtureRowCount(client, floor), "the first send must write both rows").toBe(2);
    await writeUplinkRows(savepointClient(client), rows, optionsFor(gatewayId, new Date()));
    expect(await fixtureRowCount(client, floor), "a retried batch must upsert the same rows").toBe(2);
  });
}

/** A late batch sets the window and records the report; a second late batch widens it. */
export async function assertALateBatchSetsAndWidensTheWindow(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    const now = new Date();
    const fourHours = new Date(now.getTime() - 4 * HOUR);
    const threeHours = new Date(now.getTime() - 3 * HOUR);
    await writeUplinkRows(savepointClient(client), [row(fourHours), row(threeHours)], optionsFor(gatewayId, now, 9));
    const first = await gatewayState(client, gatewayId);
    expect(first.backfill_dirty_from?.toISOString()).toBe(fourHours.toISOString());
    expect(first.backfill_dirty_to?.toISOString()).toBe(threeHours.toISOString());
    expect(first.last_seen_at?.toISOString()).toBe(now.toISOString());
    expect(first.reported_backlog).toBe(9);
    expect(first.clock_state).toBe("synced");

    const fiveHours = new Date(now.getTime() - 5 * HOUR);
    const twoAndAHalf = new Date(now.getTime() - 2.5 * HOUR);
    await writeUplinkRows(savepointClient(client), [row(fiveHours), row(twoAndAHalf)], optionsFor(gatewayId, now));
    const second = await gatewayState(client, gatewayId);
    expect(second.backfill_dirty_from?.toISOString(), "LEAST must move from back").toBe(fiveHours.toISOString());
    expect(second.backfill_dirty_to?.toISOString(), "GREATEST must move to forward").toBe(twoAndAHalf.toISOString());

    // A narrower late batch inside the window leaves it as wide as it was.
    await writeUplinkRows(savepointClient(client), [row(fourHours)], optionsFor(gatewayId, now));
    const third = await gatewayState(client, gatewayId);
    expect(third.backfill_dirty_from?.toISOString()).toBe(fiveHours.toISOString());
    expect(third.backfill_dirty_to?.toISOString()).toBe(twoAndAHalf.toISOString());
  });
}

/** A live-only batch records the report and leaves the window NULL. */
export async function assertALiveOnlyBatchLeavesTheWindowNull(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    const now = new Date();
    await writeUplinkRows(savepointClient(client), [row(new Date(now.getTime() - 1_000))], optionsFor(gatewayId, now, 0));
    const state = await gatewayState(client, gatewayId);
    expect(state.last_seen_at?.toISOString(), "the report is recorded").toBe(now.toISOString());
    expect(state.backfill_dirty_from).toBeNull();
    expect(state.backfill_dirty_to).toBeNull();
  });
}

/** A gateway revoked after the snapshot matches no row: the rows roll back with it. */
export async function assertARevokedGatewayRollsTheBatchBack(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    await client.query("UPDATE bms.edge_gateways SET status = 'revoked' WHERE id = $1", [gatewayId]);
    const now = new Date();
    const floor = new Date(now.getTime() - HOUR);
    await expect(
      writeUplinkRows(savepointClient(client), [row(new Date(now.getTime() - 1_000))], optionsFor(gatewayId, now)),
    ).rejects.toThrow(/rolled back/);
    expect(await fixtureRowCount(client, floor), "the batch's rows must roll back with the report").toBe(0);
  });
}

/** A token rotated out after the snapshot no longer matches `token_hash`: the batch rolls back (M1). */
export async function assertARotatedTokenRollsTheBatchBack(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    const now = new Date();
    const floor = new Date(now.getTime() - HOUR);
    await expect(
      writeUplinkRows(
        savepointClient(client),
        [row(new Date(now.getTime() - 1_000))],
        optionsFor(gatewayId, now, 0, OTHER_DIGEST),
      ),
    ).rejects.toThrow(/rolled back/);
    expect(await fixtureRowCount(client, floor), "a stale token's rows must roll back").toBe(0);
  });
}

/** `backfill_dirty_seq` counts every late batch, inside the window or not, and no live one (code review 2). */
export async function assertEveryLateBatchBumpsTheSeq(pool: pg.Pool): Promise<void> {
  await withFixtureGateway(pool, async (client, gatewayId) => {
    const seq = async (): Promise<string> =>
      (
        await client.query<{ s: string }>("SELECT backfill_dirty_seq::text AS s FROM bms.edge_gateways WHERE id = $1", [
          gatewayId,
        ])
      ).rows[0].s;
    expect(await seq(), "a new gateway starts at 0").toBe("0");
    const now = new Date();
    await writeUplinkRows(savepointClient(client), [row(new Date(now.getTime() - 4 * HOUR))], optionsFor(gatewayId, now));
    expect(await seq()).toBe("1");
    await writeUplinkRows(savepointClient(client), [row(new Date(now.getTime() - 4 * HOUR), 5)], optionsFor(gatewayId, now));
    expect(await seq(), "a late batch inside an unchanged window still bumps it").toBe("2");
    await writeUplinkRows(savepointClient(client), [row(new Date(now.getTime() - 1_000))], optionsFor(gatewayId, now));
    expect(await seq(), "a live-only batch leaves it").toBe("2");
  });
}

/**
 * The uplink transaction runs under `statement_timeout = 14s`, and the setting
 * does not outlive it on the pooled connection (round-two review M-new).
 *
 * **This one case commits**, on purpose: under the savepoint shim a plain `SET`
 * and a `SET LOCAL` both vanish at the outer `ROLLBACK`, so only a real
 * `COMMIT` can show the setting did not leak. It writes **zero** telemetry rows
 * (nothing to delete, no aggregate to refresh), commits one fixture gateway
 * row, and deletes it by id in `finally`.
 */
export async function assertTheStatementTimeoutIsLocalToTheTransaction(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  let gatewayId: string | undefined;
  try {
    const before = (await client.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0]
      .statement_timeout;
    expect(before, "control: the pool's default must differ from the uplink's bound").not.toBe("14s");
    const org = await client.query<{ id: string }>("SELECT id FROM bms.organizations WHERE code = 'ESKOM'");
    expect(org.rows.length, "needs the seeded ESKOM organization — run pnpm db:seed").toBe(1);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO bms.edge_gateways (organization_id, code, name, token_hash)
       VALUES ($1, $2, 'E7.2 uplink timeout fixture', $3) RETURNING id`,
      [org.rows[0].id, "E72-UPLINK-TIMEOUT-FIXTURE", FIXTURE_DIGEST],
    );
    gatewayId = inserted.rows[0].id;

    let inside: string | undefined;
    const spy: QueryableClient = {
      async query(text, values) {
        if (text.includes("UPDATE bms.edge_gateways")) {
          inside = (await client.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0]
            .statement_timeout;
        }
        return values === undefined ? client.query(text) : client.query(text, [...values]);
      },
    };
    await writeUplinkRows(spy, [], optionsFor(gatewayId, new Date()));
    expect(inside, "inside the uplink transaction statement_timeout must be 14s").toBe("14s");
    const after = (await client.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0]
      .statement_timeout;
    expect(after, "SET LOCAL must not leak past COMMIT onto the pooled connection").toBe(before);
  } finally {
    if (gatewayId !== undefined) {
      await client.query("DELETE FROM bms.edge_gateways WHERE id = $1", [gatewayId]);
    }
    client.release();
  }
}
