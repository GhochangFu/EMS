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

/**
 * `F3.4` post-merge sweep (2026-09-16, security Low) — no C0/C1 control
 * character in either free-text field.
 *
 * Both fields were bounded by **length only**, so `a\r\nb.png` was stored and
 * read back verbatim. Nothing harmful follows from that today, and the reason
 * is narrow: the content route sends the constant `Content-Disposition:
 * inline` with no `filename=` parameter. That is the exact shape of Amendment
 * 2's `sha256`→`ETag` case, where a stored CR reached `res.setHeader` and
 * threw `ERR_INVALID_CHAR` — the field was harmless until one header quoted
 * it. The gate belongs on the field, not on the current set of readers.
 *
 * `\p{Cc}` is the Unicode "Other, control" category: U+0000–U+001F and
 * U+007F–U+009F. Everything else — accents, CJK, emoji — is accepted, so a
 * legitimate name keeps parsing. The pattern is **exported and imported**
 * rather than restated in `apps/api/src/assets/asset-images.schema.ts`
 * (§4.8): two copies of a security pattern drift in silence.
 */
export const NO_CONTROL_CHARACTERS = /^[^\p{Cc}]*$/u;

/**
 * `F3.4` — the per-asset image cap (R-3, owner Q-3). Exceeding it is a state
 * of the resource, not a malformed body — the write path answers 409
 * Conflict, not the 400 a `.max()` bound on a request field would give (the
 * `F4.103` distinction). Annotated `: number` for the `TS2367` reason above.
 *
 * **§4.8 encoding:** nothing composed here — a bare number, no `.merge()`,
 * no `z.intersection`, no `.readonly()` — so the flattening scan has nothing
 * to see.
 */
export const MAX_ASSET_IMAGES_PER_ASSET: number = 20;

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
    originalFilename: z.string().max(MAX_ASSET_IMAGE_FILENAME_CHARS).regex(NO_CONTROL_CHARACTERS),
    caption: z.string().max(MAX_ASSET_IMAGE_CAPTION_CHARS).regex(NO_CONTROL_CHARACTERS).nullable(),
    createdBy: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** `GET /api/v1/assets/:assetId/images`. */
export const assetImageListResponseSchema = z.array(assetImageDtoSchema);
