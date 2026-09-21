import { z } from "zod";

import { MAX_ASSET_IMAGE_FILENAME_CHARS, NO_CONTROL_CHARACTERS } from "./asset-images";
import { energyReportTemplateSchema } from "./operations";

/**
 * `F3.5a` — the stored report file contracts (ADR 0071 decisions 4, 6, 11;
 * Amendment 1).
 *
 * **`objectKey` is deliberately absent from `reportFileDtoSchema`** (decision
 * 4/11): the key is server-generated — `buildReportObjectKey` under
 * `org/<org>/reports/<fileId>` — and never sent to a client, so it has no
 * place in a response DTO. `reports.spec.ts` pins this refusal the same way
 * `asset-images.spec.ts:63` does.
 *
 * **Encoding (§4.8):** `reportFileDtoSchema` is a plain `z.object().strict()`
 * — no `.merge()`, no `z.intersection`, no `.readonly()`. It is not composed
 * from another schema and it is not an all-readonly type, so none of those
 * apply; naming that here lets a reviewer confirm the flattening scan has
 * nothing to flag (`asset-images.ts`'s docblock sentence, restated).
 *
 * `organizationId` and `locationIds` **are** carried even though the web had
 * no use for either before F3.5b: the schedule section reads both.
 */

/** The two formats a report file may be saved as (ADR 0071 decision 3). */
export const reportFileFormatSchema = z.enum(["pdf", "xlsx"]);

/** Derived from the schema, never restated (§4.8). */
export const REPORT_FILE_FORMATS = reportFileFormatSchema.options;

/**
 * `F3.5b`'s email-attachment outcome, written here so the DTO shape is fixed
 * before that queue exists. `F3.5a` writes `none` and never changes it.
 */
export const reportDeliveryStatusSchema = z.enum(["none", "sent", "skipped_unconfigured", "failed"]);

/**
 * Derived by identity from the energy report template's own `id` literal
 * (§4.8) — never restated. Today the only report template.
 */
export const reportTemplateIdSchema = energyReportTemplateSchema.shape.id;

/**
 * Annotated `: number` rather than left as a literal type — the
 * `queue-config.ts` `DEFAULT_WORKER_PORT` / `MAX_ASSET_IMAGE_BYTES` lesson.
 * Without the annotation, `tsc` narrows a comparison against this constant to
 * a tautology and refuses it with `TS2367`. `readReportFilesConfig` reads
 * `REPORT_ONDEMAND_CAP` with this as its default (R-11).
 */
export const REPORT_ONDEMAND_CAP_DEFAULT: number = 50;

/**
 * Annotated `: number` for the same `TS2367` reason as
 * `REPORT_ONDEMAND_CAP_DEFAULT` above. `reportSchedulesController` reads this
 * as the 409 cap (R-12, Q-5).
 */
export const MAX_REPORT_SCHEDULES_PER_ORGANIZATION: number = 50;

/** Annotated `: number` for the same `TS2367` reason. `name.max(…)` (R-16). */
export const MAX_REPORT_SCHEDULE_NAME_CHARS: number = 120;

/**
 * Annotated `: number` for the same `TS2367` reason. `readReportFilesConfig`
 * reads `REPORT_RETENTION_PER_SCHEDULE` with this as its default (R-14).
 */
export const REPORT_RETENTION_PER_SCHEDULE_DEFAULT: number = 24;

/**
 * Annotated `: number` for the same `TS2367` reason. `readReportFilesConfig`
 * reads `REPORT_EMAIL_MAX_BYTES` with this as its default (R-14).
 */
export const REPORT_EMAIL_MAX_BYTES_DEFAULT: number = 10_485_760;

/** How often a schedule's report runs (ADR 0071 decision 7; R-7). */
export const reportCadenceSchema = z.enum(["daily", "weekly", "monthly"]);

/** Derived from the schema, never restated (§4.8). */
export const REPORT_CADENCES = reportCadenceSchema.options;

/**
 * `run_at_local`'s wire shape — `HH:MM`, 24-hour, no seconds (R-16: `pg`'s
 * `HH:MM:SS` is sliced down to this before it reaches a DTO).
 */
export const RUN_AT_LOCAL_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One row of `bms.report_files`. No `objectKey` — see the file docblock.
 */
export const reportFileDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    templateId: reportTemplateIdSchema,
    format: reportFileFormatSchema,
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    locationIds: z.array(z.string().uuid()),
    contentType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    filename: z.string().max(MAX_ASSET_IMAGE_FILENAME_CHARS).regex(NO_CONTROL_CHARACTERS),
    deliveryStatus: reportDeliveryStatusSchema,
    deliveryError: z.string().nullable(),
    scheduleId: z.string().uuid().nullable(),
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** `GET /api/v1/reports/files`. */
export const reportFileListResponseSchema = z.array(reportFileDtoSchema);

/**
 * `F3.5b` — one row of `bms.report_schedules` (ADR 0071 decisions 7–12).
 *
 * **Encoding (§4.8):** a plain `z.object().strict()` — no `.merge()`, no
 * `z.intersection`, no `.readonly()`. It is not composed from another schema
 * and it is not an all-readonly type, so none of those apply (`reports.ts`'s
 * own precedent, restated).
 */
export const reportScheduleDtoSchema = z
  .object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    name: z.string().min(1).max(MAX_REPORT_SCHEDULE_NAME_CHARS).regex(NO_CONTROL_CHARACTERS),
    templateId: reportTemplateIdSchema,
    formats: z.array(reportFileFormatSchema).min(1),
    cadence: reportCadenceSchema,
    runAtLocal: z.string().regex(RUN_AT_LOCAL_PATTERN),
    timezone: z.string().min(1).max(64),
    locationIds: z.array(z.string().uuid()),
    channelId: z.string().uuid().nullable(),
    enabled: z.boolean(),
    nextRunAt: z.string().datetime({ offset: true }),
    lastRunAt: z.string().datetime({ offset: true }).nullable(),
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** `GET /api/v1/reports/schedules`. */
export const reportScheduleListResponseSchema = z.array(reportScheduleDtoSchema);
