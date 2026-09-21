import { z } from "zod";

import { isCalendarDate } from "../reports/report-files.schema";
import { defineQueue } from "./queue-registry";

/**
 * The `reports-render` queue (ADR 0071 decision 8) — one render job per
 * due schedule, on `rules-sweep.ts`'s shape.
 *
 * `reportsDispatchQueue`'s tick enqueues one job per due row; the processor
 * (`ReportRenderService`, in `reports/`) loads the schedule under RLS,
 * resolves `location_ids` to asset ids under RLS, renders on the fleet pool
 * exactly as the controller does, writes the files, prunes to the
 * configured retention, then emails them.
 *
 * **Tenant.** Unlike `reports-dispatch`, a render job belongs to one
 * organization — `organizationId` drives the tenant GUC the processor runs
 * under (ADR 0063 decision 6). The calendar-date fields reuse F3.5a's
 * `isCalendarDate` refine (`reports/report-files.schema.ts`) — the regex
 * alone would admit `2026-02-30`, which V8 rolls forward silently.
 */
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, { message: "is not a calendar date" });

export const reportsRenderQueue = defineQueue({
  name: "reports-render",
  tenancy: "tenant",
  payload: z
    .object({
      organizationId: z.string().uuid(),
      scheduleId: z.string().uuid(),
      periodStart: calendarDateSchema,
      periodEnd: calendarDateSchema,
    })
    .strict()
    .refine((value) => value.periodStart <= value.periodEnd, {
      message: "periodEnd must not be before periodStart",
    }),
});

/**
 * The render job's id: `<scheduleId>_<periodEnd>` — an underscore, not a
 * colon. ADR 0071 decision 8 wrote `<scheduleId>:<periodEnd>`, but
 * `assertJobId` (`queue-registry.ts`) refuses any colon (BullMQ 5.81.5
 * throws `Custom Id cannot contain :` — measured 2026-09-11); neither a
 * uuid nor an ISO calendar date contains an underscore, so the two segments
 * split unambiguously. R-1; corrected in ADR 0071 Amendment 2. One job per
 * schedule per period end — a second dispatch tick that finds the same row
 * still due (e.g. a retried tick) enqueues the same id, and BullMQ
 * de-duplicates it while the earlier job is still retained.
 */
export function renderJobId(scheduleId: string, periodEnd: string): string {
  return `${scheduleId}_${periodEnd}`;
}
