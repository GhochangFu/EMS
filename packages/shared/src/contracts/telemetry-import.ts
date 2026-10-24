/**
 * CSV/Excel telemetry bulk-import contracts (`F1.9`, ADR 0018).
 *
 * Reuses `rejectedRowDtoSchema` from `./telemetry-entry` (Phase A, frozen for
 * this feature pair per the plan) rather than restating it — a row rejected
 * by the parser, by asset-code resolution, or by `TelemetryWriteService`
 * itself is reported the same shape either way.
 */
import { z } from "zod";

import { copilotAttachmentRefSchema } from "./copilot";
import { rejectedRowDtoSchema, writableSourceKindSchema } from "./telemetry-entry";

/**
 * The upload cap decided in the plan's tunables section (`F1.9`) — 5 MiB.
 * `F4.283` (ADR 0030): moved here from `telemetry-import.schema.ts`, so the
 * copilot catalog's `upload.maxBytes` and the web's attach picker read one value.
 */
export const MAX_IMPORT_FILE_BYTES: number = 5 * 1024 * 1024;

/**
 * The multipart form fields that ride alongside the uploaded file on both
 * `POST /admin/telemetry/import/preview` and `.../commit`. `sourceKind`
 * reuses `writableSourceKindSchema` (ADR 0018) rather than restating its
 * vocabulary — `measured` is excluded there for the same reason it is
 * excluded from manual entry: the API cannot supply the `rtu_id` a
 * `measured` row's CHECK constraint requires.
 *
 * `F4.283` (ADR 0030): moved here from
 * `apps/api/src/admin/telemetry-import/telemetry-import.schema.ts`, same rules.
 */
export const telemetryImportOptionsBodySchema = z
  .object({
    sourceKind: writableSourceKindSchema.default("unmapped"),
    conflictPolicy: z.enum(["reject", "overwrite"]).default("reject"),
  })
  .strict();

export type TelemetryImportOptions = z.infer<typeof telemetryImportOptionsBodySchema>;

/**
 * `F4.283` (ADR 0099 Amendment 8, Q18, Q21): the body the copilot proposes an
 * import with — the route's options with `conflictPolicy` fixed to `"reject"`,
 * and the attached file by its index. The propose step turns `file` into the
 * file's name and SHA-256; the bytes stay in the browser.
 */
export const copilotTelemetryImportModelBodySchema = z
  .object({
    sourceKind: writableSourceKindSchema.optional(),
    conflictPolicy: z.literal("reject").optional(),
    file: copilotAttachmentRefSchema,
  })
  .strict();

export type CopilotTelemetryImportModelBody = z.infer<typeof copilotTelemetryImportModelBodySchema>;

/** `F4.283`: the most rejected rows and mapping names the card-only preview keeps (the counts stay complete). */
export const COPILOT_IMPORT_PREVIEW_REJECTED_MAX = 20;
export const COPILOT_IMPORT_PREVIEW_MAPPINGS_MAX = 50;

/**
 * `F4.283` (Amendment 8, Q18): what the import card shows — the route's own
 * `preview` counts, at most 20 of its rejected rows, and at most 50 of the
 * `asset_points` mappings the commit would create. Stored under the entry's
 * `cardOnly` key `preview`, so the hash leaves it out and the browser strips it.
 */
export const copilotTelemetryImportPreviewSchema = z
  .object({
    totalRows: z.number(),
    acceptedCount: z.number(),
    rejectedCount: z.number(),
    rejected: z.array(rejectedRowDtoSchema).max(COPILOT_IMPORT_PREVIEW_REJECTED_MAX),
    mappingsToCreate: z
      .array(z.object({ assetCode: z.string(), pointKey: z.string() }).readonly())
      .max(COPILOT_IMPORT_PREVIEW_MAPPINGS_MAX),
  })
  .readonly();

export type CopilotTelemetryImportPreview = z.infer<typeof copilotTelemetryImportPreviewSchema>;

/**
 * The result of `POST /admin/telemetry/import/preview` — nothing is written.
 *
 * `acceptedCount` reflects only structural row validation and asset-code
 * resolution. The catalog point-key check, unit precedence, the retention
 * window and mapping-conflict handling all belong to `TelemetryWriteService`
 * alone (Phase A) — duplicating them here would be a second, drifting copy
 * of decisions OQ-2/OQ-3 already made once, so a row counted as accepted by
 * preview can still be rejected at commit. `commit` is the authority.
 */
export const telemetryImportPreviewDtoSchema = z
  .object({
    totalRows: z.number(),
    acceptedCount: z.number(),
    rejectedCount: z.number(),
    rejected: z.array(rejectedRowDtoSchema),
  })
  .readonly();

/** The result of `POST /admin/telemetry/import/commit` — what was actually written. */
export const telemetryImportCommitDtoSchema = z
  .object({
    written: z.number(),
    skipped: z.number(),
    assetPointsCreated: z.number(),
    firstTime: z.string().nullable(),
    lastTime: z.string().nullable(),
    batchId: z.string().uuid(),
    rejected: z.array(rejectedRowDtoSchema),
  })
  .readonly();
