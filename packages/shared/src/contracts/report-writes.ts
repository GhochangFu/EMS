import { z } from "zod";

import { NO_CONTROL_CHARACTERS } from "./asset-images";
import { foldRepeatedQueryValue } from "./query-values";
import {
  MAX_REPORT_SCHEDULE_NAME_CHARS,
  reportCadenceSchema,
  reportFileFormatSchema,
  RUN_AT_LOCAL_PATTERN,
} from "./reports";

/**
 * `F4.280` (ADR 0099 Amendment 8, ADR 0030) — the request bodies of the report
 * write routes (`report-schedules.controller.ts`, `report-files.controller.ts`)
 * and the energy-report query, moved here from `apps/api/src/reports/` so the
 * copilot catalog entries carry the route's own body by identity. The API
 * schema files keep the id params and the list query and re-export these.
 *
 * Plain `z.object`s from module-level field constants (the `rule-writes.ts`
 * pattern): no `.merge()`, no `.omit().extend()` — `tests/adr-0030-contract-derivation.test.ts`
 * scans for both — no `z.intersection`, since nothing here is composed, and no
 * `.readonly()`, since nothing here is all-readonly.
 *
 * `F3.5b` (ADR 0071 decisions 7, 11; plan R-6, R-12): every body is `.strict()`
 * and carries a ledger entry in `apps/api/src/testing/strict-body-ledger.data.ts`.
 *
 * **The timezone refine is the R-6 rule** — {@link isValidTimeZone}: a
 * `/`-separated name whose every segment starts with an uppercase letter and
 * that `Intl.DateTimeFormat` constructs. It runs at the parse so the 400 names
 * the field (`fieldErrors.timezone`) and the service never sees a zone
 * `nextRunAt` would throw on. `asia/kolkata` is refused, `Asia/Kolkata` passes
 * (the amended R-6: ICU canonicalises to `Asia/Calcutta`, so the exact-case
 * equality of the first draft refused the pilot's own zone).
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
 * **Step-5 security M1 — the save body refuses a calendar-invalid date.** The
 * regex admits `2026-02-30`; V8 rolls it to `03-02`, so the render and the
 * `putObject` ran and Postgres then rejected the `date` insert — a 500 after
 * a stored object. {@link isCalendarDate} round-trips the value through
 * `Date` and refuses one that does not come back unchanged. The three export
 * routes keep `energyReportQuerySchema`'s silent roll (a recorded residual;
 * they store nothing), so the refine lives on the save body and not on the
 * shared shape.
 *
 * `.describe()` follows every refine (ADR 0029 Amendment 1: before it, the
 * description lands on the inner node and the document says nothing).
 */

const ZONE_SEGMENT_CASING = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/;

/** R-6: contains `/`, constructs without `RangeError`, every segment capitalised. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone.includes("/") || !ZONE_SEGMENT_CASING.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch (err) {
    if (err instanceof RangeError) {
      return false;
    }
    throw err;
  }
}

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

/**
 * `F4.290` (ADR 0099 Amendment 9 E4; owner ruling P6) — the site filter of an
 * on-demand energy report: site ids, each meaning the site and its
 * descendants, at most 200 (the schedule's bound). Unlike a schedule's
 * `location_ids`, where `[]` means "the whole organization", a filter names at
 * least one site: an absent filter is the unfiltered report, so `[]` would be a
 * second spelling of it and is refused. A repeated id is refused too: the save
 * stamps the list as given, and "scoped to 2 locations" for one site would be wrong.
 */
const reportSiteFilterSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, { message: "locationIds names a location twice" })
  .describe("1 to 200 location ids, each named once; each covers that site and everything under it.");

/**
 * The three energy export routes' query (not `.strict()`, as before the move).
 * `F4.290`: optional `locationIds`, folded from a repeated `?locationIds=` as
 * every API query is ({@link foldRepeatedQueryValue}).
 */
export const energyReportQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationIds: z.preprocess(foldRepeatedQueryValue, reportSiteFilterSchema.optional()),
});

export type EnergyReportQuery = z.infer<typeof energyReportQuerySchema>;

const TIMEZONE_DESCRIPTION =
  "An IANA zone name such as Asia/Kolkata or Europe/London: slash-separated, each segment " +
  "starting with an uppercase letter, and known to the runtime's ICU data.";

const FORMATS_DESCRIPTION = "One or more of pdf and xlsx, each at most once.";

const CALENDAR_DATE_DESCRIPTION =
  "An ISO calendar date (YYYY-MM-DD) that exists — 2026-02-30 is refused, never rolled forward.";

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

const channelIdSchema = z.string().uuid().nullable().optional();

const startDateSchema = energyReportQuerySchema.shape.startDate
  .refine(isCalendarDate, { message: "startDate is not a calendar date" })
  .describe(CALENDAR_DATE_DESCRIPTION);

const endDateSchema = energyReportQuerySchema.shape.endDate
  .refine(isCalendarDate, { message: "endDate is not a calendar date" })
  .describe(CALENDAR_DATE_DESCRIPTION);

/** Amendment 1 item 1 — required for a global admin and for an admin holding several organizations. */
const optionalOrganizationIdSchema = z.string().uuid().optional();

export const createReportScheduleBodySchema = z
  .object({
    name: nameSchema,
    formats: formatsSchema,
    cadence: reportCadenceSchema,
    runAtLocal: runAtLocalSchema,
    timezone: timezoneSchema,
    locationIds: locationIdsSchema,
    channelId: channelIdSchema,
    enabled: z.boolean().optional(),
    organizationId: optionalOrganizationIdSchema,
  })
  .strict();

export type CreateReportScheduleBody = z.infer<typeof createReportScheduleBodySchema>;

export const updateReportScheduleBodySchema = z
  .object({
    name: nameSchema.optional(),
    formats: formatsSchema.optional(),
    cadence: reportCadenceSchema.optional(),
    runAtLocal: runAtLocalSchema.optional(),
    timezone: timezoneSchema.optional(),
    locationIds: locationIdsSchema.optional(),
    channelId: channelIdSchema,
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "PATCH body must carry at least one field",
  })
  .describe("A partial schedule: any subset of the create body's fields except organizationId, at least one.");

export type UpdateReportScheduleBody = z.infer<typeof updateReportScheduleBodySchema>;

export const saveEnergyReportFileBodySchema = z
  .object({
    startDate: startDateSchema,
    endDate: endDateSchema,
    format: reportFileFormatSchema,
    organizationId: optionalOrganizationIdSchema,
    locationIds: reportSiteFilterSchema.optional(),
  })
  .strict();

export type SaveEnergyReportFileBody = z.infer<typeof saveEnergyReportFileBodySchema>;

/**
 * `F4.280` (Amendment 8, Q7; the F4.279 Q13 pattern) — the copilot proposes a
 * schedule create naming its organization: the route body with
 * `organizationId` required, so the target is never the caller's default.
 */
export const copilotCreateReportScheduleModelBodySchema = z
  .object({
    name: nameSchema,
    formats: formatsSchema,
    cadence: reportCadenceSchema,
    runAtLocal: runAtLocalSchema,
    timezone: timezoneSchema,
    locationIds: locationIdsSchema,
    channelId: channelIdSchema,
    enabled: z.boolean().optional(),
    organizationId: z.string().uuid(),
  })
  .strict();

/** `F4.280` (Q7): the on-demand save, with its organization named. */
export const copilotSaveEnergyReportFileModelBodySchema = z
  .object({
    startDate: startDateSchema,
    endDate: endDateSchema,
    format: reportFileFormatSchema,
    organizationId: z.string().uuid(),
    locationIds: reportSiteFilterSchema.optional(),
  })
  .strict();
