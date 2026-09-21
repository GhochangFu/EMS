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
 */
export const saveEnergyReportFileBodySchema = z
  .object({
    startDate: energyReportQuerySchema.shape.startDate,
    endDate: energyReportQuerySchema.shape.endDate,
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
