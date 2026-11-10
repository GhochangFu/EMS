import { NOTIFY_LIVE_WINDOW_MS } from "@bms/shared/ingest";

import { assert } from "./normaliser.spec.js";
import { writeResolved, type PointValueRow, type QueryableClient } from "./normaliser.js";
import {
  DIRTY_AFTER_MS,
  RECORD_GATEWAY_REPORT,
  dirtyWindow,
  writeUplinkRows,
} from "./uplink-write.js";

/**
 * `E7.2` / ADR 0123 decision 11, plan T3.3 and C7 — the receiver's write and
 * the gateway report share one transaction.
 *
 * Assertions live here; `uplink-write.test.ts` is the vitest entry point (ADR
 * 0014). A fake client records every statement in order; the real SQL is
 * `uplink-write.integration.spec.ts`'s.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const GATEWAY = "11111111-1111-4111-8111-111111111111";
const DIGEST = Buffer.alloc(32, 7);
const REPORT = { gatewayId: GATEWAY, buffered: 42, clock: "unsynced", tokenDigest: DIGEST } as const;
const OPTIONS = { now: NOW, liveWindowMs: NOTIFY_LIVE_WINDOW_MS, report: REPORT };

type Call = { text: string; values?: readonly unknown[] };

/** A fake that answers `rowCount: updateRowCount` to the gateway UPDATE and can fail one statement. */
export function fakeTx(options: { failOn?: RegExp; updateRowCount?: number } = {}): {
  client: QueryableClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: QueryableClient = {
    async query(text, values) {
      calls.push({ text, values });
      if (options.failOn?.test(text) === true) {
        throw new Error("simulated database failure");
      }
      if (text.includes("UPDATE bms.edge_gateways")) {
        return { rowCount: options.updateRowCount ?? 1 };
      }
      return { rowCount: 0 };
    },
  };
  return { client, calls };
}

function rowAt(ageMs: number, pointKey = "P"): PointValueRow {
  return {
    time: new Date(NOW.getTime() - ageMs),
    assetId: "asset-a",
    pointKey,
    value: 1,
    unit: null,
    deviceTime: null,
  };
}

/** The statement kinds, in order. */
function kinds(calls: readonly Call[]): string[] {
  return calls.map((c) => {
    if (c.text.startsWith("INSERT INTO telemetry.point_values")) return "upsert";
    if (c.text.includes("UPDATE bms.edge_gateways")) return "gateway";
    if (c.text.includes("pg_notify")) return "notify";
    return c.text.trim();
  });
}

/** BEGIN, upsert, gateway UPDATE, COMMIT, then notify — nothing announced before it is durable. */
export async function theOrderIsBeginUpsertUpdateCommitNotify(): Promise<void> {
  const { client, calls } = fakeTx();
  const result = await writeUplinkRows(client, [rowAt(1_000)], OPTIONS);
  const order = kinds(calls).join(",");
  assert(order === "BEGIN,upsert,gateway,COMMIT,notify", `statement order was ${order}`);
  assert(result.rowsWritten === 1 && result.notificationsSent === 1, "one row written and notified");
}

/** A failing gateway UPDATE rolls the batch back and notifies nothing. */
export async function aFailingUpdateRollsBackAndNotifiesNothing(): Promise<void> {
  const { client, calls } = fakeTx({ failOn: /UPDATE bms\.edge_gateways/ });
  let threw = false;
  try {
    await writeUplinkRows(client, [rowAt(1_000)], OPTIONS);
  } catch {
    threw = true;
  }
  assert(threw, "a failed gateway UPDATE must reject, so the receiver answers 503");
  const order = kinds(calls).join(",");
  assert(order === "BEGIN,upsert,gateway,ROLLBACK", `statement order was ${order}`);
}

/** A gateway revoked since the last reload matches no row: the batch rolls back. */
export async function anInactiveGatewayRollsBack(): Promise<void> {
  const { client, calls } = fakeTx({ updateRowCount: 0 });
  let threw = false;
  try {
    await writeUplinkRows(client, [rowAt(1_000)], OPTIONS);
  } catch {
    threw = true;
  }
  assert(threw, "an UPDATE that moved no row must reject");
  assert(kinds(calls).join(",") === "BEGIN,upsert,gateway,ROLLBACK", "it must roll back, never commit");
}

/** Zero rows still records the gateway: BEGIN, UPDATE, COMMIT, no notify. */
export async function zeroRowsStillRecordsTheGateway(): Promise<void> {
  const { client, calls } = fakeTx();
  const result = await writeUplinkRows(client, [], OPTIONS);
  const order = kinds(calls).join(",");
  assert(order === "BEGIN,gateway,COMMIT", `statement order was ${order}`);
  assert(result.rowsWritten === 0 && result.notificationsSent === 0, "nothing written, nothing notified");
  // And writeResolved without the hook keeps its early return.
  const plain = fakeTx();
  await writeResolved(plain.client, [], { now: () => NOW, liveWindowMs: NOTIFY_LIVE_WINDOW_MS });
  assert(plain.calls.length === 0, "writeResolved with no rows and no hook must not open a transaction");
}

/** The UPDATE binds the gateway id, now, buffered, clock and the late rows' span. */
export async function theUpdateBindsTheReportAndTheWindow(): Promise<void> {
  const { client, calls } = fakeTx();
  const oldest = rowAt(DIRTY_AFTER_MS + 3_600_000, "A");
  const newestLate = rowAt(DIRTY_AFTER_MS + 1, "B");
  await writeUplinkRows(client, [newestLate, rowAt(1_000, "C"), oldest], OPTIONS);
  const update = calls.find((c) => c.text.includes("UPDATE bms.edge_gateways"));
  const values = update?.values ?? [];
  assert(values[0] === GATEWAY, "$1 must be the gateway id");
  assert(values[1] instanceof Date && values[1].getTime() === NOW.getTime(), "$2 must be now");
  assert(values[2] === 42 && values[3] === "unsynced", "$3 buffered, $4 clock");
  assert(values[4] instanceof Date && values[4].getTime() === oldest.time.getTime(), "$5 must be the oldest late row");
  assert(
    values[5] instanceof Date && values[5].getTime() === newestLate.time.getTime(),
    "$6 must be the newest late row, not the live one",
  );
  assert(values[6] === DIGEST, "$7 must be the presented token's digest (M1)");
}

/** A live-only batch binds NULL for both bounds, so the window is left as it was. */
export async function aLiveOnlyBatchBindsNoWindow(): Promise<void> {
  const { client, calls } = fakeTx();
  await writeUplinkRows(client, [rowAt(DIRTY_AFTER_MS), rowAt(1_000, "B")], OPTIONS);
  const values = calls.find((c) => c.text.includes("UPDATE bms.edge_gateways"))?.values ?? [];
  assert(values[4] === null && values[5] === null, "a row exactly DIRTY_AFTER_MS old is not dirty; no late row, no window");
}

/** A `buffered` larger than an int4 is clamped, never a failed write that would block the queue. */
export async function aHugeBufferedIsClamped(): Promise<void> {
  const { client, calls } = fakeTx();
  await writeUplinkRows(client, [], { ...OPTIONS, report: { ...REPORT, buffered: 3_000_000_000 } });
  const values = calls.find((c) => c.text.includes("UPDATE bms.edge_gateways"))?.values ?? [];
  assert(values[2] === 2_147_483_647, `buffered must clamp to int4 max, got ${String(values[2])}`);
}

/** The SQL widens with LEAST / GREATEST and filters by id and active status. */
export function theSqlWidensAndFiltersByGateway(): void {
  const sql = RECORD_GATEWAY_REPORT.replace(/\s+/g, " ");
  assert(sql.includes("backfill_dirty_from = LEAST(g.backfill_dirty_from, $5::timestamptz)"), "from must widen with LEAST");
  assert(sql.includes("backfill_dirty_to = GREATEST(g.backfill_dirty_to, $6::timestamptz)"), "to must widen with GREATEST");
  assert(
    /WHERE g\.id = \$1 AND g\.status = 'active' AND g\.token_hash = \$7 /.test(sql),
    "the UPDATE must filter by its own gateway id, active status and the presented digest",
  );
  assert(
    sql.includes("AND EXISTS ( SELECT 1 FROM bms.organizations o WHERE o.id = g.organization_id AND o.ingest_enabled = true )"),
    "the UPDATE must require the organization's ingest switch (ADR 0115), so a stale snapshot rolls back",
  );
  assert(
    sql.includes(
      "backfill_dirty_seq = CASE WHEN $5::timestamptz IS NULL THEN g.backfill_dirty_seq ELSE g.backfill_dirty_seq + 1 END",
    ),
    "every late batch must bump backfill_dirty_seq, and no live-only one",
  );
  const window = dirtyWindow([rowAt(1_000)], NOW);
  assert(window === null, "dirtyWindow of live rows is null");
}
