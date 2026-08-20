/**
 * CSV/Excel telemetry bulk-import contracts (`F1.9`, ADR 0018).
 *
 * Reuses `rejectedRowDtoSchema` from `./telemetry-entry` (Phase A, frozen for
 * this feature pair per the plan) rather than restating it — a row rejected
 * by the parser, by asset-code resolution, or by `TelemetryWriteService`
 * itself is reported the same shape either way.
 */
import { z } from "zod";

import { rejectedRowDtoSchema } from "./telemetry-entry";

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
