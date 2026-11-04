import { z } from "zod";

import { defineQueue } from "./queue-registry";

/**
 * The `calc-backfill` queue (`F4.311` PR 5, ADR 0109 decision 7) — one job
 * per backfill run of one calculated point, computing up to 31 days of its
 * history on the worker.
 *
 * **Tenant.** A run belongs to one organization; the producer takes
 * `organizationId` from the asset row it wrote, never from the JWT or the
 * body. The worker claims the run inside `withTenant` on that organization,
 * so `bms.calc_backfill_runs`' RLS binds it.
 *
 * **Ids only, and `.strict()`.** The window, the point and the progress are
 * on the run row; the payload names it. A formula, a window or anything else
 * is refused at `enqueue` and again at the processor.
 *
 * **`attempts: 3`.** A chunk that throws fails the run by error name and
 * rethrows; the retry re-claims the same run and resumes at `done_through`
 * (the walk never overwrites a stored value, so a re-run chunk is a no-op at
 * the database). Idempotency is on the run row, not on the job.
 */
export const calcBackfillQueue = defineQueue({
  name: "calc-backfill",
  tenancy: "tenant",
  payload: z
    .object({
      organizationId: z.string().uuid(),
      runId: z.string().uuid(),
      assetPointId: z.string().uuid(),
    })
    .strict(),
  retry: { attempts: 3 },
});

/** The BullMQ job id of one run — `JOB_ID_PATTERN` grammar, no colon. */
export function calcBackfillJobId(runId: string): string {
  return `calc-backfill-${runId}`;
}
