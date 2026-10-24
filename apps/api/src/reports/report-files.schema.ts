import { z } from "zod";

import type { SaveEnergyReportFileBody } from "@bms/shared";

/**
 * `F3.5a` (ADR 0071 decision 11; Amendment 1 item 1) — the request schemas
 * of the four report-file routes. Every one is `.strict()`, as decision 11
 * says; the query sits in `openapi/strict-body-ledger.spec.ts`'s
 * `QUERY_SCHEMAS` (the `mappingSheetQuerySchema` precedent: no ledger entry
 * for a query).
 *
 * `F4.280` (ADR 0030): the save body (`saveEnergyReportFileBodySchema`) and
 * `isCalendarDate` moved to `packages/shared/src/contracts/report-writes.ts`;
 * the controller imports the body from `@bms/shared`, and `isCalendarDate` is
 * re-exported here so its importers stay unchanged.
 */
export { isCalendarDate } from "@bms/shared";

export type SaveEnergyReportFileBodyInput = SaveEnergyReportFileBody;

/** R-7: newest first, no offset — the on-demand cap bounds the set until `F3.5b`. */
export const listReportFilesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type ListReportFilesQuery = z.infer<typeof listReportFilesQuerySchema>;

export const reportFileIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type ReportFileIdParam = z.infer<typeof reportFileIdParamSchema>;
