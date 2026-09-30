import { z } from "zod";

import {
  MIMIC_ORG_LIBRARY_CODE,
  MIMIC_ORG_SYMBOL_NAME,
  MIMIC_SYMBOL_GROUP_CODES,
  NO_CONTROL_CHARACTERS,
  mimicSymbolStyleSchema,
} from "@bms/shared";

/**
 * `F3.32f` slice 3 / ADR 0086 decisions 4, 6 and 7 (plan D5) — the request shapes of
 * `/api/v1/mimic-symbol-libraries`. The vocabularies come from `@bms/shared`, never restated
 * (ADR 0030); migration `0093`'s CHECKs restate the code and key grammars.
 *
 * Every body is `.strict()`: an unknown key is a typo, not an extension point. The four JSON
 * bodies are registered in `openapi-registry.ts`; the multipart upload's fields
 * (`mimicSymbolUploadFieldsSchema`) are not — the asset-images precedent, because the generator
 * hard-codes `application/json`.
 */

/**
 * A path `:libraryCode` of the settings route, bounded only. Whether it names an active global
 * library is the service's check (one 400 "Unknown symbol library", no echo), so the enum's
 * option list never reaches a refusal.
 */
export const mimicLibraryCodeParamSchema = z.string().min(1).max(32);

/** `GET ?organizationId=` — absent means every organization the caller reads. */
export const mimicSymbolLibrariesQuerySchema = z
  .object({
    organizationId: z.string().uuid().optional(),
  })
  .strict();

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

/** `:id/symbols/:symbolId`. */
export const mimicOrgSymbolParamsSchema = z
  .object({
    id: z.string().uuid(),
    symbolId: z.string().uuid(),
  })
  .strict();

export type MimicSymbolLibrariesQuery = z.infer<typeof mimicSymbolLibrariesQuerySchema>;
export type CreateMimicOrgSymbolLibraryBody = z.infer<typeof createMimicOrgSymbolLibraryBodySchema>;
export type UpdateMimicOrgSymbolLibraryBody = z.infer<typeof updateMimicOrgSymbolLibraryBodySchema>;
export type UpdateMimicOrgSymbolBody = z.infer<typeof updateMimicOrgSymbolBodySchema>;
export type PutMimicLibrarySettingBody = z.infer<typeof putMimicLibrarySettingBodySchema>;
export type MimicSymbolUploadFields = z.infer<typeof mimicSymbolUploadFieldsSchema>;
