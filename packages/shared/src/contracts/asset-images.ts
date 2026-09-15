import { z } from "zod";

/**
 * `F3.3` — the asset-image constants and DTO (ADR 0066 decisions 3, 5, 7).
 *
 * These constants are shared between `F3.3` (the read path: list + content)
 * and `F3.4` (the write path: upload). Both routes cap a payload against
 * `MAX_ASSET_IMAGE_BYTES` and both validate a content type against the same
 * closed vocabulary — a security allowlist (§4.8's closed-`z.enum` case), not
 * a domain vocabulary that wants a lookup table.
 *
 * **`objectKey` is deliberately absent from `assetImageDtoSchema`** (ADR 0066
 * decision 4): the key is server-generated and never sent to a client, so it
 * has no place in a response DTO. `asset-images.spec.ts` pins this refusal.
 *
 * **Encoding (§4.8):** `assetImageDtoSchema` is a plain `z.object().strict()`
 * — no `.merge()`, no `z.intersection`, no `.readonly()`. It is not composed
 * from another schema and it is not an all-readonly type, so none of those
 * apply; naming that here lets a reviewer confirm the flattening scan has
 * nothing to flag.
 */

/**
 * Annotated `: number` rather than left as a literal type — the
 * `queue-config.ts` `DEFAULT_WORKER_PORT` lesson. Without the annotation,
 * TypeScript narrows a comparison against this constant to a tautology and
 * `tsc` refuses it with `TS2367`.
 */
export const MAX_ASSET_IMAGE_BYTES: number = 10 * 1024 * 1024;

/**
 * Bounds on the two free-text fields (review finding, 2026-09-15). The SQL
 * columns `original_filename` and `caption` stay `text` — migration `0072` is
 * frozen — so the DTO's `.max()` here and `F3.4`'s write path, which reads
 * these two constants, are the gate. 255 is the common filesystem name limit;
 * 1000 is a caption, not a document. Annotated `: number` for the `TS2367`
 * reason above.
 */
export const MAX_ASSET_IMAGE_FILENAME_CHARS: number = 255;
export const MAX_ASSET_IMAGE_CAPTION_CHARS: number = 1000;

/** The closed content-type vocabulary an asset image may carry (ADR 0066 decision 7). */
export const assetImageContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

/** Derived from the schema, never restated (§4.8). */
export const ASSET_IMAGE_CONTENT_TYPES = assetImageContentTypeSchema.options;

/**
 * `GET /api/v1/assets/:assetId/images` (one element) and the row shape behind
 * `GET .../images/:imageId/content`. No `objectKey` — see the file docblock.
 */
export const assetImageDtoSchema = z
  .object({
    id: z.string().uuid(),
    assetId: z.string().uuid(),
    contentType: assetImageContentTypeSchema,
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    originalFilename: z.string().max(MAX_ASSET_IMAGE_FILENAME_CHARS),
    caption: z.string().max(MAX_ASSET_IMAGE_CAPTION_CHARS).nullable(),
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** `GET /api/v1/assets/:assetId/images`. */
export const assetImageListResponseSchema = z.array(assetImageDtoSchema);
