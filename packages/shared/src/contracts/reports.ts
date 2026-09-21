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
 * **`scheduleId` is absent from this DTO.** The column arrives with F3.5b's
 * migration `0078` — a hard-coded `null` here would be a lie that later
 * becomes true. `organizationId` and `locationIds` **are** carried even
 * though the web has no use for either today: F3.5b's schedule section reads
 * both.
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
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** `GET /api/v1/reports/files`. */
export const reportFileListResponseSchema = z.array(reportFileDtoSchema);
