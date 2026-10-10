import { z } from "zod";

import { defineQueue } from "./queue-registry";

/**
 * The `copilot-purge` queue (`F3.85` PR 5, ADR 0099 decision 8) — the
 * copilot history's 30-day retention tick, on `reports-dispatch.ts`'s shape.
 *
 * The worker host upserts one repeatable job every
 * `COPILOT_PURGE_INTERVAL_MS` (default 24 h, `queue-config.ts`) under
 * `COPILOT_PURGE_SCHEDULER_ID`; the processor (`CopilotPurgeService`, in
 * `copilot/`) lists every user on the fleet pool and, per user inside
 * `withUser`, deletes the conversations untouched for 30 days (their
 * messages cascade; their pending changes keep the row with
 * `conversation_id` set to NULL), deletes the orphaned `pending` and
 * `rejected` changes older than 30 days, and fails the `applying` claims
 * older than 30 days. This file holds only the declaration.
 *
 * **Fleet, not tenant.** The tick is not scoped to one organization; the
 * fleet handle only lists `users.id` (`0105` revokes the copilot tables from
 * `bms_fleet`), and every write runs on the tenant pool under the
 * `user_isolation` policy. The payload is `z.object({}).strict()` — the
 * scheduler is the identity.
 *
 * **Retry policy: `RETRY_DEFAULTS`.** Every statement is idempotent (a
 * second run finds nothing older than the cut-off), so a retried tick is
 * harmless.
 */

/** The job scheduler id. The scheduler is the identity — there is no `jobId` on a repeatable job. */
export const COPILOT_PURGE_SCHEDULER_ID = "copilot-purge";

export const copilotPurgeQueue = defineQueue({
  name: "copilot-purge",
  tenancy: "fleet",
  payload: z.object({}).strict(),
});
