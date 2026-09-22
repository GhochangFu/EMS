import { z } from "zod";

import { defineQueue } from "./queue-registry";

/**
 * The `reports-dispatch` queue (ADR 0071 decision 8) — the scheduled
 * report tick's declaration, on `rules-sweep.ts`'s shape.
 *
 * The worker host upserts one repeatable job every
 * `REPORT_DISPATCH_INTERVAL_MS` under `REPORT_DISPATCH_SCHEDULER_ID`
 * (`queue-config.ts`); the processor (`ReportDispatchService`, in
 * `reports/`) claims every due, enabled `bms.report_schedules` row
 * `FOR UPDATE SKIP LOCKED`, enqueues one `reports-render` job per row, and
 * advances `next_run_at`. This file holds only the declaration — what both
 * processes share.
 *
 * **Fleet, not tenant.** The read is cross-organization by design (the
 * `rules-sweep` reasoning — a schedule belongs to one organization, but the
 * tick that finds due schedules is not itself scoped to one). The payload is
 * `z.object({}).strict()` — the scheduler is the identity, and the schema
 * refuses a field being smuggled in, at `upsertSchedule` and again at the
 * processor.
 *
 * **Retry policy: `RETRY_DEFAULTS`.** A tick that throws is retried on
 * backoff and its failure counted in `bms_queue_jobs_total{queue=
 * "reports-dispatch",outcome="failed"}`; the rows it would have claimed stay
 * due for the next scheduled tick (decision 8: enqueue-then-advance inside
 * one transaction, so a tick that fails mid-way leaves every unclaimed row
 * exactly as due as it was).
 */

/** The job scheduler id. The scheduler is the identity — there is no `jobId` on a repeatable job. */
export const REPORT_DISPATCH_SCHEDULER_ID = "reports-dispatch";

export const reportsDispatchQueue = defineQueue({
  name: "reports-dispatch",
  tenancy: "fleet",
  payload: z.object({}).strict(),
});
