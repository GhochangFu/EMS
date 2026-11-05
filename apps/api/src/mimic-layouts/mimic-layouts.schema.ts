import { z } from "zod";

/**
 * `F4.308` / ADR 0081 Amendment 2 decision 2 (plan C1) — the query of
 * `GET /api/v1/mimic-layouts/:id/preview`. `assetGroupId` is required and a UUID; `.strict()`: an
 * unknown key is a 400, not a silently ignored filter. In a `*.schema.ts`, never inline in the
 * controller, so the OpenAPI registry sees it (ADR 0029).
 */
export const mimicLayoutPreviewQuerySchema = z
  .object({
    assetGroupId: z.string().uuid().describe("The asset group of the layout's organization to preview the layout against."),
  })
  .strict();

export type MimicLayoutPreviewQuery = z.infer<typeof mimicLayoutPreviewQuerySchema>;
