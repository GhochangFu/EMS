import { z } from "zod";

import { mimicOrgSymbolDtoSchema, mimicSymbolLibraryCodeSchema } from "./mimic-layouts";
import { mimicOrgLibraryKeySchema, mimicSymbolStyleSchema } from "./mimic-symbol-libraries";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4 and 7 — `GET /api/v1/mimic-symbol-libraries` and the
 * switch's answer. Its own module because it reads `./mimic-layouts` (the static library codes,
 * the stored symbol's DTO), which reads `./mimic-symbol-libraries`: one direction only.
 *
 * Plain `z.object` throughout — no `.merge()`, `.extend()`, `.pick()` or `.omit()` (ADR 0030
 * decision 2).
 */

/** One global library as an author sees it for one organization: the row, and the switch. */
export const mimicGlobalLibraryStatusDtoSchema = z.object({
  code: mimicSymbolLibraryCodeSchema,
  label: z.string(),
  style: mimicSymbolStyleSchema,
  licence: z.string(),
  active: z.boolean(),
  /** `false` when the organization turned it off; no settings row reads `true` (decision 4). */
  enabled: z.boolean(),
  /** The library's retired symbol keys: the bundle does not know them (decision 7). */
  inactiveSymbolKeys: z.array(z.string()),
});

/** One organization library, retired ones included, with its symbols (shapes included). */
export const mimicOrgSymbolLibraryDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  code: z.string(),
  key: mimicOrgLibraryKeySchema,
  label: z.string(),
  style: mimicSymbolStyleSchema,
  licence: z.string(),
  attribution: z.string(),
  sourceUrl: z.string().nullable(),
  active: z.boolean(),
  symbolCount: z.number().int(),
  symbols: z.array(mimicOrgSymbolDtoSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** `PUT /api/v1/mimic-symbol-libraries/settings/:libraryCode` — the switch as stored. */
export const mimicLibrarySettingDtoSchema = z.object({
  organizationId: z.string().uuid(),
  libraryCode: mimicSymbolLibraryCodeSchema,
  enabled: z.boolean(),
  updatedAt: z.string(),
});

/** `GET /api/v1/mimic-symbol-libraries`. */
export const mimicSymbolLibrariesResponseSchema = z.object({
  global: z.array(mimicGlobalLibraryStatusDtoSchema),
  organization: z.array(mimicOrgSymbolLibraryDtoSchema),
});
