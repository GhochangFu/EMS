import { telemetryEntryRowSchema } from "@bms/shared";
import { z } from "zod";

/**
 * The F1.8/F1.9 manual-entry request body. `sourceKind` is deliberately
 * absent — the controller hardcodes `"manual"`, so a caller cannot ask for
 * anything else; `.strict()` turns an attempt into a 400 rather than a
 * silently-ignored key. Row count is capped at 50 (A4a's M2, discharged for
 * this endpoint only — F1.9's own bulk-import cap is separate).
 */
export const manualReadingsBodySchema = z
  .object({
    rows: z.array(telemetryEntryRowSchema).min(1).max(50),
    conflictPolicy: z.enum(["reject", "overwrite"]).default("reject"),
  })
  .strict();
