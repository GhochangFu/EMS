import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "@bms/shared";
import { z } from "zod";

/**
 * `F3.39` / ADR 0051 — the catalog is fleet-wide, so a create names no
 * organization. The body is `.strict()` (ADR 0029), so a client still sending
 * `organizationId` gets a 400 rather than having it silently ignored.
 */
export const createPointKeyBodySchema = z
  .object({
    // F2.23 / ADR 0065 decision 1: the catalog class, after the length bound.
    code: z.string().min(1).max(128).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE),
    name: z.string().min(1).max(255),
    domain: z.string().max(64).optional(),
    unit: z.string().max(32).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

export const updatePointKeyBodySchema = createPointKeyBodySchema
  .omit({ code: true })
  .partial();

export type CreatePointKeyBody = z.infer<typeof createPointKeyBodySchema>;
export type UpdatePointKeyBody = z.infer<typeof updatePointKeyBodySchema>;
