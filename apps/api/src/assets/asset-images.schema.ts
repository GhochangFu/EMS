import { z } from "zod";

import { MAX_ASSET_IMAGE_CAPTION_CHARS, MAX_ASSET_IMAGE_FILENAME_CHARS, NO_CONTROL_CHARACTERS } from "@bms/shared";

/**
 * `F3.3` (ADR 0066 decision 6) — the path parameters of the two asset-image
 * read routes.
 *
 * **Why neither schema is in `openapi-registry.ts` or the strict-body
 * ledger.** The registry binds a route to the `*BodySchema`/`*QuerySchema`
 * that validates its payload (ADR 0029 decisions 1 and 3), and
 * `tests/adr-0029-openapi-contract.test.ts` scans controllers for exactly
 * those two suffixes. Both routes here take no body and no query — only
 * path parameters, which Nest's own reflection describes — so there is
 * nothing to register and no node enters `strict-body-ledger.data.ts`,
 * the same as `EscalationProfilesController_list` (the comment at
 * `openapi-registry.ts` says so). The schemas live in a `*.schema.ts`
 * anyway, rather than inline in the controller, so a later query parameter
 * has a home the registry can already see.
 *
 * A failed `.parse()` throws `ZodError`, which the global `ZodErrorFilter`
 * (`main.ts`) turns into a 400 — so a non-uuid segment never reaches the
 * access check or a pool.
 */
export const assetImageParamsSchema = z
  .object({ assetId: z.string().uuid(), imageId: z.string().uuid() })
  .strict();

export type AssetImageParams = z.infer<typeof assetImageParamsSchema>;

/** `:assetId` on the list route. */
export const assetIdParamSchema = z.string().uuid();

/**
 * `F3.4` (ADR 0066 Amendment 3, R-8) — the multipart upload's non-file
 * field, and the sniffed-from-`file.originalname` filename.
 *
 * **Named `*FieldsSchema`/`*FilenameSchema`, not `*BodySchema`.** The upload
 * route is multipart, and `openapi-registry.ts`'s "multipart routes are
 * deliberately absent" paragraph (ADR 0029 decisions 1 and 3) describes only
 * a JSON `*BodySchema`/`*QuerySchema` pair; `tests/adr-0029-openapi-contract
 * .test.ts` forbids exactly those two suffixes inline in a controller. These
 * two schemas carry neither suffix and live in this `*.schema.ts` file, not
 * inline in a controller, so the scan has nothing to flag either way.
 *
 * No `.refine` on either schema, so decision 10's `.describe()` rule on a
 * `.refine` has nothing to hold here.
 */
export const assetImageUploadFieldsSchema = z
  .object({
    caption: z.string().trim().max(MAX_ASSET_IMAGE_CAPTION_CHARS).regex(NO_CONTROL_CHARACTERS).optional(),
  })
  .strict();

export type AssetImageUploadFields = z.infer<typeof assetImageUploadFieldsSchema>;

/**
 * The filename multer reports on `file.originalname`, after
 * `decodeMulterFilename` has undone busboy's latin1 decode.
 *
 * **The control-character refusal (post-merge sweep, security Low)** mirrors
 * the shared DTO's, through the **same imported pattern** — a second copy of
 * a security regex drifts in silence (§4.8). It matters here as well as in
 * the DTO because `.trim()` only removes *surrounding* whitespace: `a\r\nb
 * .png` keeps its interior CR LF and would otherwise be stored and read back
 * verbatim. `.min(1)` stays: an empty name is a missing name, not a
 * control character.
 */
export const assetImageFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ASSET_IMAGE_FILENAME_CHARS)
  .regex(NO_CONTROL_CHARACTERS);

export type AssetImageFilename = z.infer<typeof assetImageFilenameSchema>;
