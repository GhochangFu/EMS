import {
  type PointValueRow,
  type QueryableClient,
  type WriteResult,
  writeResolved,
} from "./normaliser.js";

/**
 * The uplink receiver's write (`E7.2`, ADR 0123 decisions 4 and 11, plan T3.3
 * and C7).
 *
 * The rows go through the supervisor's own `writeResolved`; the gateway's
 * report — `last_seen_at`, `reported_backlog`, `clock_state` (ruling P2 (a))
 * — and its dirty window are written by its `beforeCommit` hook, **in the
 * same transaction**. So a committed late row always has its window recorded,
 * and a host that crashes between the write and the aggregate refresh finds
 * the window on restart: it is a column, not a memory.
 *
 * The host connects as `bms_fleet` (BYPASSRLS), so the `UPDATE` filters by the
 * gateway's id itself. **The commit is bound to the credential and the switch,
 * not only to the snapshot** (security review M1): it also requires
 * `status = 'active'`, `token_hash` equal to the digest the request
 * authenticated with, and the organization's `ingest_enabled`. A gateway
 * revoked, a token rotated out, or an organization switched off after the
 * last snapshot reload therefore matches no row, the hook throws, and the
 * whole batch rolls back (`503`; the edge keeps it; the next reload answers
 * 401 or 403). The digest compare here runs only after `authenticate` has
 * already matched it in constant time, so it is no oracle.
 */

/**
 * A row older than this marks its gateway's dirty window (C7).
 *
 * The `_1m` refresh policy (migration `0027`) re-covers the last 3 h, so a row
 * younger than that reaches the aggregates on the policy's own schedule; 2 h
 * leaves a 1 h margin for a policy run that is late.
 * `tests/e7.2-uplink-dirty-window-static.test.ts` ties the two together.
 */
export const DIRTY_AFTER_MS = 2 * 3_600_000;

/**
 * Server-side bounds on the uplink transaction (security review round two).
 * The receiver's own 15 s bound (`UPLINK_WRITE_TIMEOUT_MS`) destroys the `pg`
 * client, but the Postgres backend would keep running its statement; these
 * make the server cancel it first, so a stall cannot pile up backends against
 * `max_connections`. `SET LOCAL`, so nothing outlives the transaction on the
 * pooled connection.
 */
export const UPLINK_STATEMENT_TIMEOUT = "14s";
export const UPLINK_LOCK_TIMEOUT = "5s";
export const UPLINK_TRANSACTION_SETTINGS: readonly string[] = [
  `SET LOCAL statement_timeout = '${UPLINK_STATEMENT_TIMEOUT}'`,
  `SET LOCAL lock_timeout = '${UPLINK_LOCK_TIMEOUT}'`,
];

/** `reported_backlog` is an `integer`; a larger report is clamped, never a failed write. */
const MAX_INT4 = 2_147_483_647;

/** What the edge said about itself in this batch. */
export type GatewayReport = {
  readonly gatewayId: string;
  /** `buffered` from the wire: samples the edge holds on disk. */
  readonly buffered: number;
  readonly clock: "synced" | "unsynced";
  /** SHA-256 of the presented token (`AuthOutcome.digest`). Never logged. */
  readonly tokenDigest: Buffer;
};

/** The span of rows older than `DIRTY_AFTER_MS`, or `null` when there is none. */
export function dirtyWindow(
  rows: readonly PointValueRow[],
  now: Date,
): { readonly from: Date; readonly to: Date } | null {
  const cutoff = now.getTime() - DIRTY_AFTER_MS;
  let from: number | undefined;
  let to: number | undefined;
  for (const row of rows) {
    const t = row.time.getTime();
    if (t >= cutoff) {
      continue;
    }
    from = from === undefined ? t : Math.min(from, t);
    to = to === undefined ? t : Math.max(to, t);
  }
  return from === undefined || to === undefined ? null : { from: new Date(from), to: new Date(to) };
}

/**
 * Records the report and widens the dirty window. `LEAST` and `GREATEST`
 * ignore a `NULL` argument in Postgres, so a batch with no late row (`$5`,
 * `$6` both `NULL`) leaves the window as it was, and a first late batch sets
 * it from `NULL`. Both bounds move together, which keeps migration `0141`'s
 * both-or-neither and ordered CHECK true.
 *
 * `backfill_dirty_seq` (migration `0143`) goes up by one for **every** batch
 * that carries a late row, whether it widened the window or landed inside it.
 * The repair pass clears only the generation it read, so a late row committed
 * inside an unchanged window while a refresh ran is never cleared unrepaired
 * (code review 2).
 */
export const RECORD_GATEWAY_REPORT = `
  UPDATE bms.edge_gateways AS g
     SET last_seen_at = $2,
         reported_backlog = $3,
         clock_state = $4,
         backfill_dirty_from = LEAST(g.backfill_dirty_from, $5::timestamptz),
         backfill_dirty_to = GREATEST(g.backfill_dirty_to, $6::timestamptz),
         backfill_dirty_seq = CASE WHEN $5::timestamptz IS NULL THEN g.backfill_dirty_seq
                                   ELSE g.backfill_dirty_seq + 1 END,
         updated_at = now()
   WHERE g.id = $1
     AND g.status = 'active'
     AND g.token_hash = $7
     AND EXISTS (
       SELECT 1 FROM bms.organizations o
        WHERE o.id = g.organization_id
          AND o.ingest_enabled = true
     )
`;

function rowCountOf(result: unknown): number | undefined {
  if (typeof result !== "object" || result === null || !("rowCount" in result)) {
    return undefined;
  }
  const { rowCount } = result as { rowCount: unknown };
  return typeof rowCount === "number" ? rowCount : undefined;
}

/** Runs `RECORD_GATEWAY_REPORT`; throws (rolling the batch back) unless exactly one row moved. */
export async function recordGatewayReport(
  client: QueryableClient,
  report: GatewayReport,
  seenAt: Date,
  window: { readonly from: Date; readonly to: Date } | null,
): Promise<void> {
  const result = await client.query(RECORD_GATEWAY_REPORT, [
    report.gatewayId,
    seenAt,
    Math.min(report.buffered, MAX_INT4),
    report.clock,
    window?.from ?? null,
    window?.to ?? null,
    report.tokenDigest,
  ]);
  if (rowCountOf(result) !== 1) {
    throw new Error("edge gateway is not active, its token was rotated, or its organization is off; batch rolled back");
  }
}

export type UplinkWriteOptions = {
  readonly now: Date;
  readonly liveWindowMs: number;
  readonly report: GatewayReport;
};

/**
 * Writes one batch's rows and the gateway's report in one transaction, then
 * notifies the live rows after `COMMIT` (`writeResolved`'s order). Zero rows
 * still records the gateway: it spoke, even if every sample was screened out.
 */
export function writeUplinkRows(
  client: QueryableClient,
  rows: readonly PointValueRow[],
  options: UplinkWriteOptions,
): Promise<WriteResult> {
  const window = dirtyWindow(rows, options.now);
  return writeResolved(client, rows, {
    now: () => options.now,
    liveWindowMs: options.liveWindowMs,
    afterBegin: async (tx) => {
      for (const statement of UPLINK_TRANSACTION_SETTINGS) {
        await tx.query(statement);
      }
    },
    beforeCommit: (tx) => recordGatewayReport(tx, options.report, options.now, window),
  });
}
