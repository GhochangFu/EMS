import { z } from "zod";

import type { CreateReportScheduleBody, UpdateReportScheduleBody } from "@bms/shared";

/**
 * `F3.5b` (ADR 0071 decisions 7, 11; plan R-6, R-12) — the schedule routes'
 * id param, with no ledger entry (a param, not a body).
 *
 * `F4.280` (ADR 0030): the create and PATCH bodies moved to
 * `packages/shared/src/contracts/report-writes.ts` (their R-6 timezone rule,
 * the duplicate-format refusal and the at-least-one-key PATCH rule with them);
 * the controller imports them from `@bms/shared`, and the two input types are
 * re-exported here under their old names for the service and its specs.
 */
export type CreateReportScheduleBodyInput = CreateReportScheduleBody;

export type UpdateReportScheduleBodyInput = UpdateReportScheduleBody;

export const reportScheduleIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type ReportScheduleIdParam = z.infer<typeof reportScheduleIdParamSchema>;
