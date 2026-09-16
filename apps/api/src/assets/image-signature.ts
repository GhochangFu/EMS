import type { AssetImageContentType } from "@bms/shared";
import { assetImageContentTypeSchema } from "@bms/shared";

/**
 * `F3.4` (ADR 0066 Amendment 3, R-1) — sniff a content type from the file's
 * own bytes, never from a client-supplied label.
 *
 * A member of the shared enum is returned only by checking membership in
 * `assetImageContentTypeSchema.options` — never a cast — so a change to the
 * vocabulary in `@bms/shared` cannot silently desync from this file.
 *
 * A buffer shorter than 12 bytes is `null`: the WebP check reads offset
 * 8-11, so anything shorter cannot be classified either way.
 */
export function sniffImageContentType(buffer: Buffer): AssetImageContentType | null {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return asContentType("image/jpeg");
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngSignature.every((byte, index) => buffer[index] === byte)) {
    return asContentType("image/png");
  }

  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return asContentType("image/webp");
  }

  return null;
}

function asContentType(candidate: string): AssetImageContentType {
  // `safeParse`, not `.parse()`: the candidate is a literal this file owns,
  // never stored data and never caller input, so it belongs in neither of
  // the two classes `tests/f4.108-service-parses-are-guarded.test.ts` admits
  // for a bare parse. A miss is a programming error in this file (a literal
  // that left the shared enum), thrown as such — it hands back a value of
  // the shared enum without a cast (R-1).
  const result = assetImageContentTypeSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(`sniffImageContentType: "${candidate}" is not a member of the shared enum`);
  }
  return result.data;
}
