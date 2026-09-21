import { z } from "zod";

import { reportFileFormatSchema } from "@bms/shared";

import { energyReportQuerySchema } from "./reports.schema";

/**
 * `F3.5a` (ADR 0071 decision 11; Amendment 1 item 1) — the request schemas
 * of the four report-file routes. Every one is `.strict()`, as decision 11
 * says; the body carries a ledger entry in `testing/strict-body-ledger.data.ts`
 * and the query sits in `openapi/strict-body-ledger.spec.ts`'s `QUERY_SCHEMAS`
 * (the `mappingSheetQuerySchema` precedent: no ledger entry for a query).
 *
 * `startDate` and `endDate` are spelled through `energyReportQuerySchema.shape`
 * rather than `.extend()`, so the two regexes have one home and this object's
 * `.strict()` is its own, not inherited.
 *
 * **Step-5 security M1 — the save body refuses a calendar-invalid date.** The
 * regex admits `2026-02-30`; V8 rolls it to `03-02`, so the render and the
 * `putObject` ran and Postgres then rejected the `date` insert — a 500 after
 * a stored object. {@link isCalendarDate} round-trips the value through
 * `Date` and refuses one that does not come back unchanged. The three export
 * routes keep `energyReportQuerySchema`'s silent roll (a recorded residual;
 * they store nothing), so the refine lives here and not on the shared shape.
 * `.describe()` follows the refine (ADR 0029 Amendment 1: before it, the
 * description lands on the inner node and the document says nothing).
 */
const CALENDAR_DATE_DESCRIPTION =
  "An ISO calendar date (YYYY-MM-DD) that exists — 2026-02-30 is refused, never rolled forward.";

/**
 * `true` only when `value` names a real calendar day. `Invalid Date`
 * (`2026-13-01`) is refused explicitly: `toISOString()` throws `RangeError`
 * on it, which would escape the parse as a 500 rather than a 400.
 */
export function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.toISOString().slice(0, 10) === value;
}

export const saveEnergyReportFileBodySchema = z
  .object({
    startDate: energyReportQuerySchema.shape.startDate
      .refine(isCalendarDate, { message: "startDate is not a calendar date" })
      .describe(CALENDAR_DATE_DESCRIPTION),
    endDate: energyReportQuerySchema.shape.endDate
      .refine(isCalendarDate, { message: "endDate is not a calendar date" })
      .describe(CALENDAR_DATE_DESCRIPTION),
    format: reportFileFormatSchema,
    /** Amendment 1 item 1 — required for a global admin and for an admin holding several organizations. */
    organizationId: z.string().uuid().optional(),
  })
  .strict();

export type SaveEnergyReportFileBodyInput = z.infer<typeof saveEnergyReportFileBodySchema>;

/** R-7: newest first, no offset — the on-demand cap bounds the set until `F3.5b`. */
export const listReportFilesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type ListReportFilesQuery = z.infer<typeof listReportFilesQuerySchema>;

export const reportFileIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type ReportFileIdParam = z.infer<typeof reportFileIdParamSchema>;
