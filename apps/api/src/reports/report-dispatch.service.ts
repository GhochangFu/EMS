import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { reportCadenceSchema } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import { enqueue, type QueueClient } from "../queue/queue-registry";
import { QUEUE_CLIENT } from "../queue/queue.tokens";
import { renderJobId, reportsRenderQueue } from "../queue/reports-render";
import { nextRunAt, periodFor } from "./report-period";

/**
 * `F3.5b` U9 — the `reports-dispatch` tick (ADR 0071 decision 8; plan R-6,
 * R-8, R-17; owner-ruled Q-3). Provided by `ReportsCoreModule`; called by
 * `WorkerHostService`'s `reports-dispatch` processor once per scheduled
 * tick, with the fleet handle `runProcessor` builds for a `fleet` queue.
 *
 * **Decision 8, verbatim:** "Its handler runs as `bms_fleet` on `ctx.db`,
 * inside one transaction: `SELECT … FROM bms.report_schedules WHERE enabled
 * AND next_run_at <= now() FOR UPDATE SKIP LOCKED`, then one `enqueue` per
 * row, then `UPDATE … SET next_run_at = <next>, last_run_at = now()` for
 * the rows enqueued, then commit. Enqueue before advance, because the queue
 * is the idempotent side: a tick that dies between the two leaves
 * `next_run_at` due, the next tick enqueues the same `jobId` and BullMQ
 * de-duplicates it while the earlier job is retained; the reverse order
 * would lose the period. A second dispatcher (an `api-replica`'s worker)
 * skips the locked rows." Two things this file adds to that sentence:
 * `now` is the tick's one clock (the argument, defaulting to `new Date()`),
 * stamped into the predicate, `last_run_at` and `updated_at` alike; and
 * the `jobId` is R-1's `<scheduleId>_<periodEnd>` (`renderJobId`), because
 * the colon form is refused before Redis.
 *
 * **Injects the queue client only.** The fleet handle is `tick(fleetDb)`'s
 * argument (the `RuleSweepService` reasoning): `reports-dispatch` is a
 * `fleet`-tenancy queue, so `runProcessor` hands the handler `{ db:
 * dbs.fleetDb }`, and a second `FLEET_DRIZZLE` injection here would be a
 * second, unrecorded route to the same pool that the processor's mapping and
 * `worker-host.service.spec.ts` could not see. `fleet-read-wiring.spec.ts`
 * pins slot 0 as `QUEUE_CLIENT`.
 *
 * **`fleetDb` may be a transaction.** `tick` calls `.transaction` on whatever
 * it is handed; Drizzle's `NodePgTransaction.transaction` opens a savepoint
 * on the same session (`drizzle-orm/node-postgres/session.js`, `savepoint
 * sp<n>` — measured at U9, and behaviourally by
 * `report-dispatch.integration.spec.ts`, whose cases insert on a
 * `withRollback` transaction and see their own rows claimed). `FOR UPDATE
 * SKIP LOCKED` never skips a row the same transaction locked, so the
 * savepoint path claims what the case inserted.
 *
 * **The period is the row's, the advance is now's (R-8, Q-3).** The render
 * period is `periodFor(cadence, row.next_run_at, timezone)` — the unit that
 * ended before the *due instant* — so a tick that runs late still covers
 * the right period; `next_run_at` is `nextRunAt(row, now)`, the next
 * occurrence strictly after *now*. A row three days overdue is enqueued
 * once, for the period before its due instant, and its missed periods are
 * skipped, never caught up (out of scope; a backfill route is a later row).
 *
 * **The poison row (R-6).** Each row's `periodFor`/`nextRunAt` runs in its
 * own `try`: a throw (an unknown zone, an unparsable clock — the
 * `ReportPeriodError` class, or anything else) is one `warn` naming the
 * schedule id and the error's `name` — never the zone string, which is an
 * operator-typed value (§9.6) — counted `skippedInvalid`, and **the row is
 * left due and enabled**: a background job has no actor for the audit row a
 * disable would owe, and one warn per tick per row is the bounded,
 * Loki-retained signal; a PATCH re-validates the zone and clears it. An
 * `enqueue` throw is **not** per-row: it aborts the tick (the transaction
 * rolls back, every row stays due, BullMQ retries on `RETRY_DEFAULTS`).
 *
 * **Summary (R-17):** `{ due, enqueued, skippedInvalid, durationMs }` — the
 * host logs one `info` line with the four counts. No Redis key and no health
 * field.
 */
export type ReportDispatchSummary = {
  readonly due: number;
  readonly enqueued: number;
  readonly skippedInvalid: number;
  readonly durationMs: number;
};

/**
 * What `tick` needs of its handle: `.transaction`. Both `BmsDb` and `BmsTx`
 * satisfy it structurally (a union of the two is not callable — their
 * generic signatures differ by an optional config parameter).
 */
export type DispatchTransactionRunner = {
  transaction<T>(fn: (tx: BmsTx) => Promise<T>): Promise<T>;
};

/**
 * The columns the claim reads, as Drizzle's raw `execute` returns them.
 * `time` is `HH:MM:SS`; **`timestamptz` is the driver's text form**, not a
 * `Date` — `drizzle-orm/node-postgres/session.js` installs its own
 * `TIMESTAMPTZ` type parser that returns the string unchanged (the column
 * mapper, which raw `execute` bypasses, is what turns it into a `Date`).
 * Measured at U9 by `report-dispatch.integration.spec.ts`: every real row
 * warned `RangeError` while the unit fake's `Date` rows passed — a shared
 * fixture hides a whole mutation class, so the unit fixture now carries
 * the text form too.
 */
type DueRow = {
  id: string;
  organization_id: string;
  cadence: string;
  run_at_local: string;
  timezone: string;
  next_run_at: string | Date;
};

/**
 * The driver's `timestamptz` text (`2026-09-21 21:17:27.123+00`) or a `Date`
 * to an instant — the same `new Date(value)` Drizzle's own
 * `PgTimestamp.mapFromDriverValue` applies. A value that parses to `NaN` is
 * a driver contract failure, not a schedule's defect: it throws a plain
 * `Error` that aborts the tick rather than being counted `skippedInvalid`.
 */
function instantOf(id: string, value: string | Date): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new Error(`report schedule ${id}: next_run_at did not parse as an instant`);
  }
  return instant;
}

@Injectable()
export class ReportDispatchService {
  private readonly logger = new Logger(ReportDispatchService.name);

  constructor(@Inject(QUEUE_CLIENT) private readonly client: QueueClient) {}

  async tick(fleetDb: DispatchTransactionRunner, now: Date = new Date()): Promise<ReportDispatchSummary> {
    const startedAt = Date.now();
    return fleetDb.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, organization_id, cadence, run_at_local, timezone, next_run_at
        FROM bms.report_schedules
        WHERE enabled AND next_run_at <= ${now}
        ORDER BY next_run_at
        FOR UPDATE SKIP LOCKED
      `);
      const rows = result.rows as DueRow[];

      let skippedInvalid = 0;
      const advanced: { id: string; next: Date }[] = [];

      for (const row of rows) {
        const dueAt = instantOf(row.id, row.next_run_at);
        let period: { periodStart: string; periodEnd: string };
        let next: Date;
        try {
          const cadence = reportCadenceSchema.parse(row.cadence);
          period = periodFor(cadence, dueAt, row.timezone);
          next = nextRunAt({ cadence, runAtLocal: row.run_at_local, timezone: row.timezone }, now);
        } catch (err) {
          skippedInvalid += 1;
          this.logger.warn(
            `report schedule ${row.id}: skipped this tick with ${errorName(err)}; the row stays due and enabled until a PATCH corrects it (ADR 0071 decision 8, plan R-6)`,
          );
          continue;
        }
        // Not caught per row: an enqueue failure aborts the tick and rolls
        // back the transaction, so every row stays due (R-6).
        await enqueue(
          this.client,
          reportsRenderQueue,
          { organizationId: row.organization_id, scheduleId: row.id, ...period },
          { jobId: renderJobId(row.id, period.periodEnd) },
        );
        advanced.push({ id: row.id, next });
      }

      // Enqueue before advance (decision 8): every job is in Redis before any
      // row moves, so a throw above leaves the rows exactly as due as they were.
      for (const { id, next } of advanced) {
        await tx.execute(sql`
          UPDATE bms.report_schedules
          SET next_run_at = ${next}, last_run_at = ${now}, updated_at = ${now}
          WHERE id = ${id}
        `);
      }

      return {
        due: rows.length,
        enqueued: advanced.length,
        skippedInvalid,
        durationMs: Date.now() - startedAt,
      };
    });
  }
}

/** The error's class name for the log line — `ReportPeriodError` for the zone and clock cases; never its message, which may quote the zone. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "Error";
}
