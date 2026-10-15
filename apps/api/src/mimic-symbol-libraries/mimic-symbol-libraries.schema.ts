import { z } from "zod";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4, 6 and 7 (plan D5) - the path and query parsers of
 * `/api/v1/mimic-symbol-libraries`. The write bodies moved to
 * `packages/shared/src/contracts/mimic-symbol-library-writes.ts` in `F3.87` PR 1 (ADR 0101
 * decision 17); a param and a query are parsed with the api's own `zod`, so they stay here.
 */

/**
 * A path `:libraryCode` of the settings route, bounded only. Whether it names an active global
 * library is the service's check (one 400 "Unknown symbol library", no echo), so the enum's
 * option list never reaches a refusal.
 */
export const mimicLibraryCodeParamSchema = z.string().min(1).max(32);

/** `GET ?organizationId=` - absent means every organization the caller reads. */
export const mimicSymbolLibrariesQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
  })
  .strict();

/** `:id/symbols/:symbolId`. */
export const mimicOrgSymbolParamsSchema = z
  .object({
    id: z.string().uuid(),
    symbolId: z.string().uuid(),
  })
  .strict();

export type MimicSymbolLibrariesQuery = z.infer<typeof mimicSymbolLibrariesQuerySchema>;
