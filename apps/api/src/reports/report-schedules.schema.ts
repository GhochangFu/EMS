import { z } from "zod";

import {
  MAX_REPORT_SCHEDULE_NAME_CHARS,
  NO_CONTROL_CHARACTERS,
  reportCadenceSchema,
  reportFileFormatSchema,
  RUN_AT_LOCAL_PATTERN,
} from "@bms/shared";

import { isValidTimeZone } from "./report-period";

/**
 * `F3.5b` (ADR 0071 decisions 7, 11; plan R-6, R-12) — the request schemas
 * of the five schedule routes. Every body is `.strict()` and carries a ledger
 * entry in `testing/strict-body-ledger.data.ts`; the id param sits beside
 * `reportFileIdParamSchema` with no entry (a param, not a body).
 *
 * **The timezone refine is the R-6 rule** — `isValidTimeZone` from
 * `report-period.ts`: a `/`-separated name whose every segment starts with an
 * uppercase letter and that `Intl.DateTimeFormat` constructs. It runs at the
 * parse so the 400 names the field (`fieldErrors.timezone`) and the service
 * never sees a zone `nextRunAt` would throw on. `asia/kolkata` is refused,
 * `Asia/Kolkata` passes (the amended R-6: ICU canonicalises to
 * `Asia/Calcutta`, so the exact-case equality of the first draft refused the
 * pilot's own zone).
 *
 * **`formats` refuses a duplicate** rather than de-duplicating it: the render
 * job iterates `REPORT_FILE_FORMATS` and tests membership, so a duplicate
 * would be harmless there, but a body that says `["pdf","pdf"]` is a caller's
 * typo and the DTO would echo it back.
 *
 * **The PATCH body is every field optional, `.strict()`, at least one key**
 * (the E4.1a empty-PATCH lesson: `{}` is a 400, not a no-op 200). It never
 * carries `organizationId` — a schedule does not move between tenants.
 *
 * `.describe()` follows every refine (ADR 0029 Amendment 1: before it, the
 * description lands on the inner node and the document says nothing).
 */
const TIMEZONE_DESCRIPTION =
  "An IANA zone name such as Asia/Kolkata or Europe/London: slash-separated, each segment " +
  "starting with an uppercase letter, and known to the runtime's ICU data.";

const FORMATS_DESCRIPTION = "One or more of pdf and xlsx, each at most once.";

const nameSchema = z.string().min(1).max(MAX_REPORT_SCHEDULE_NAME_CHARS).regex(NO_CONTROL_CHARACTERS);

const formatsSchema = z
  .array(reportFileFormatSchema)
  .min(1)
  .refine((formats) => new Set(formats).size === formats.length, {
    message: "formats must not repeat a format",
  })
  .describe(FORMATS_DESCRIPTION);

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "timezone is not a known IANA zone" })
  .describe(TIMEZONE_DESCRIPTION);

const runAtLocalSchema = z.string().regex(RUN_AT_LOCAL_PATTERN, "runAtLocal must be HH:MM (24-hour)");

/** At most 200 locations per schedule — a step-3 bound on the existence read (`IN (...)` over the list); not in R-12. */
const locationIdsSchema = z.array(z.string().uuid()).max(200);

export const createReportScheduleBodySchema = z
  .object({
    name: nameSchema,
    formats: formatsSchema,
    cadence: reportCadenceSchema,
    runAtLocal: runAtLocalSchema,
    timezone: timezoneSchema,
    locationIds: locationIdsSchema,
    channelId: z.string().uuid().nullable().optional(),
    enabled: z.boolean().optional(),
    /** Amendment 1 item 1 — required for a global admin and for an admin holding several organizations. */
    organizationId: z.string().uuid().optional(),
  })
  .strict();

export type CreateReportScheduleBodyInput = z.infer<typeof createReportScheduleBodySchema>;

export const updateReportScheduleBodySchema = z
  .object({
    name: nameSchema.optional(),
    formats: formatsSchema.optional(),
    cadence: reportCadenceSchema.optional(),
    runAtLocal: runAtLocalSchema.optional(),
    timezone: timezoneSchema.optional(),
    locationIds: locationIdsSchema.optional(),
    channelId: z.string().uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "PATCH body must carry at least one field",
  })
  .describe("A partial schedule: any subset of the create body's fields except organizationId, at least one.");

export type UpdateReportScheduleBodyInput = z.infer<typeof updateReportScheduleBodySchema>;

export const reportScheduleIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export type ReportScheduleIdParam = z.infer<typeof reportScheduleIdParamSchema>;
