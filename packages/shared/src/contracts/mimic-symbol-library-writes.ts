import { z } from "zod";

import { NO_CONTROL_CHARACTERS } from "./asset-images";
import { MIMIC_SYMBOL_GROUP_CODES } from "./mimic-layouts";
import { MIMIC_ORG_LIBRARY_CODE, MIMIC_ORG_SYMBOL_NAME, mimicSymbolStyleSchema } from "./mimic-symbol-libraries";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4, 6 and 7 (plan D5) — the write bodies of
 * `/api/v1/mimic-symbol-libraries`; moved here from `apps/api` unchanged by `F3.87` PR 1 (ADR 0101
 * decision 17). The path and query parsers stay in `apps/api/src/mimic-symbol-libraries/`. The
 * vocabularies come from `./mimic-symbol-libraries` and `./mimic-layouts`, never restated
 * (ADR 0030); migration `0093`'s CHECKs restate the code and key grammars.
 *
 * Every body is `.strict()`: an unknown key is a typo, not an extension point. The four JSON
 * bodies are registered in `openapi-registry.ts`; the multipart upload's fields
 * (`mimicSymbolUploadFieldsSchema`) are not — the asset-images precedent, because the generator
 * hard-codes `application/json`.
 */

const label = z.string().trim().min(1).max(64).regex(NO_CONTROL_CHARACTERS);
const licence = z.string().trim().min(1).max(64).regex(NO_CONTROL_CHARACTERS);
const attribution = z.string().trim().max(2000);
const sourceUrl = z
  .string()
  .trim()
  .max(255)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: "A source URL is http or https" })
  .describe("An http or https URL of at most 255 characters.");

/** `POST /api/v1/mimic-symbol-libraries` — a new organization library. */
export const createMimicOrgSymbolLibraryBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    code: z.string().regex(MIMIC_ORG_LIBRARY_CODE),
    label,
    style: mimicSymbolStyleSchema,
    licence,
    attribution: attribution.default(""),
    sourceUrl: sourceUrl.nullish(),
  })
  .strict();

/** The fields a library patch may state — the emptiness check's whole vocabulary. */
const LIBRARY_PATCH_FIELDS = ["label", "licence", "attribution", "sourceUrl", "active"] as const;

/**
 * `PATCH /api/v1/mimic-symbol-libraries/:id` — at least one field. `active: false` retires the
 * library (decision 7); there is no delete route. Read field by field, because a key present
 * with an `undefined` value survives parsing (the `asset-points` bulk-patch rule).
 */
export const updateMimicOrgSymbolLibraryBodySchema = z
  .object({
    label: label.optional(),
    licence: licence.optional(),
    attribution: attribution.optional(),
    sourceUrl: sourceUrl.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => LIBRARY_PATCH_FIELDS.some((field) => body[field] !== undefined), {
    message: `State at least one of: ${LIBRARY_PATCH_FIELDS.join(", ")}`,
  })
  .describe(`A patch states at least one of: ${LIBRARY_PATCH_FIELDS.join(", ")}.`);

const SYMBOL_PATCH_FIELDS = ["label", "group", "active"] as const;

/** `PATCH /api/v1/mimic-symbol-libraries/:id/symbols/:symbolId` — at least one field. */
export const updateMimicOrgSymbolBodySchema = z
  .object({
    label: label.optional(),
    group: z.enum(MIMIC_SYMBOL_GROUP_CODES).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((body) => SYMBOL_PATCH_FIELDS.some((field) => body[field] !== undefined), {
    message: `State at least one of: ${SYMBOL_PATCH_FIELDS.join(", ")}`,
  })
  .describe(`A patch states at least one of: ${SYMBOL_PATCH_FIELDS.join(", ")}.`);

/** `PUT /api/v1/mimic-symbol-libraries/settings/:libraryCode` — the per-organization switch. */
export const putMimicLibrarySettingBodySchema = z
  .object({
    organizationId: z.string().uuid(),
    enabled: z.boolean(),
  })
  .strict();

/**
 * The multipart upload's non-file fields, all optional (plan R3: absent ones default from the
 * filename). An empty string from a form field that was left blank reads as absent.
 */
export const mimicSymbolUploadFieldsSchema = z
  .object({
    name: z.string().max(64).regex(MIMIC_ORG_SYMBOL_NAME).optional().or(z.literal("")),
    label: label.optional().or(z.literal("")),
    group: z.enum(MIMIC_SYMBOL_GROUP_CODES).optional().or(z.literal("")),
  })
  .strict();

/** The uploaded file's name after `decodeMulterFilename` — the `assetImageFilenameSchema` twin. */
export const mimicSymbolFilenameSchema = z.string().trim().min(1).max(255).regex(NO_CONTROL_CHARACTERS);

export type CreateMimicOrgSymbolLibraryBody = z.infer<typeof createMimicOrgSymbolLibraryBodySchema>;
export type UpdateMimicOrgSymbolLibraryBody = z.infer<typeof updateMimicOrgSymbolLibraryBodySchema>;
export type UpdateMimicOrgSymbolBody = z.infer<typeof updateMimicOrgSymbolBodySchema>;
export type PutMimicLibrarySettingBody = z.infer<typeof putMimicLibrarySettingBodySchema>;
export type MimicSymbolUploadFields = z.infer<typeof mimicSymbolUploadFieldsSchema>;
