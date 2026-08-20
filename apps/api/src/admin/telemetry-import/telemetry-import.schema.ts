import { z } from "zod";

import { writableSourceKindSchema } from "@bms/shared";

/** The upload cap decided in the plan's tunables section (`F1.9`) — 5 MiB. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The multipart form fields that ride alongside the uploaded file on both
 * `POST /admin/telemetry/import/preview` and `.../commit`. `sourceKind`
 * reuses `writableSourceKindSchema` (`@bms/shared`, ADR 0018) rather than
 * restating its vocabulary — `measured` is excluded there for the same
 * reason it is excluded from manual entry: the API cannot supply the
 * `rtu_id` a `measured` row's CHECK constraint requires.
 */
export const telemetryImportOptionsBodySchema = z
  .object({
    sourceKind: writableSourceKindSchema.default("unmapped"),
    conflictPolicy: z.enum(["reject", "overwrite"]).default("reject"),
  })
  .strict();

export type TelemetryImportOptions = z.infer<typeof telemetryImportOptionsBodySchema>;
