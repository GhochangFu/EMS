import { ASSET_IMAGE_CONTENT_TYPES } from "@bms/shared";

import {
  assetImageFilenameSchema,
  assetImageUploadFieldsSchema,
} from "./asset-images.schema";
import { sniffImageContentType } from "./image-signature";

/**
 * `F3.4` (ADR 0066 Amendment 3, R-1, R-8) — the image-signature sniff and the
 * two multipart request schemas.
 *
 * Assertions live here; `image-signature.test.ts` is the vitest entry point
 * (§4.6/ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Pads a signature prefix with zero bytes to reach the 12-byte floor. */
function padded(bytes: readonly number[]): Buffer {
  const buffer = Buffer.alloc(12);
  bytes.forEach((byte, index) => {
    buffer[index] = byte;
  });
  return buffer;
}

export function assertJpegPrefixSniffsAsJpeg(): void {
  const buffer = padded([0xff, 0xd8, 0xff]);
  const result = sniffImageContentType(buffer);
  assert(result === "image/jpeg", `expected "image/jpeg", got ${JSON.stringify(result)}`);
}

export function assertPngSignatureSniffsAsPng(): void {
  const buffer = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = sniffImageContentType(buffer);
  assert(result === "image/png", `expected "image/png", got ${JSON.stringify(result)}`);
}

export function assertRiffWebpSniffsAsWebp(): void {
  const buffer = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WEBP", "ascii"),
  ]);
  const result = sniffImageContentType(buffer);
  assert(result === "image/webp", `expected "image/webp", got ${JSON.stringify(result)}`);
}

/** Proves bytes 8-11 are actually read, not just the RIFF prefix. */
export function assertRiffWaveIsNull(): void {
  const buffer = Buffer.concat([
    Buffer.from("RIFF", "ascii"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("WAVE", "ascii"),
  ]);
  const result = sniffImageContentType(buffer);
  assert(result === null, `expected null for a RIFF/WAVE buffer, got ${JSON.stringify(result)}`);
}

/**
 * The high-bit twin of the RIFF/WEBP signature, which is not an image at all.
 *
 * Node's `ascii` decoder masks bit 7 instead of refusing the byte, so
 * `D2 C9 C6 C6` decodes to "RIFF" and `D7 C5 C2 D0` to "WEBP". A sniff
 * written with `buffer.toString("ascii", …)` therefore stored these twelve
 * bytes as `image/webp` — and the route served them back under that type.
 * Only a numeric comparison of the sixteen signature bytes refuses them.
 */
export function assertHighBitRiffWebpLookalikeIsNull(): void {
  const buffer = Buffer.from([0xd2, 0xc9, 0xc6, 0xc6, 0, 0, 0, 0, 0xd7, 0xc5, 0xc2, 0xd0]);
  const result = sniffImageContentType(buffer);
  assert(
    result === null,
    `expected null for the high-bit RIFF/WEBP lookalike, got ${JSON.stringify(result)}`,
  );
}

export function assertShortPngPrefixIsNull(): void {
  const full = padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const short = full.subarray(0, 11);
  const result = sniffImageContentType(short);
  assert(result === null, `expected null for an 11-byte buffer, got ${JSON.stringify(result)}`);
}

export function assertGifHeaderIsNull(): void {
  const buffer = padded(Array.from(Buffer.from("GIF89a", "ascii")));
  const result = sniffImageContentType(buffer);
  assert(result === null, `expected null for a GIF header, got ${JSON.stringify(result)}`);
}

export function assertEmptyBufferIsNull(): void {
  const result = sniffImageContentType(Buffer.alloc(0));
  assert(result === null, `expected null for an empty buffer, got ${JSON.stringify(result)}`);
}

/** Positive control on the membership check: whatever comes back is one of the three. */
export function assertReturnedValueIsAMemberOfTheSharedEnum(): void {
  const buffer = padded([0xff, 0xd8, 0xff]);
  const result = sniffImageContentType(buffer);
  assert(
    result !== null && (ASSET_IMAGE_CONTENT_TYPES as readonly string[]).includes(result),
    `expected the result to be a member of ASSET_IMAGE_CONTENT_TYPES, got ${JSON.stringify(result)}`,
  );
}

export function assertUploadFieldsBlankCaptionParses(): void {
  const result = assetImageUploadFieldsSchema.safeParse({ caption: "" });
  assert(
    result.success === true && result.data.caption === "",
    `expected a blank caption to parse to "", got ${JSON.stringify(result)}`,
  );
}

export function assertUploadFieldsOverlongCaptionIsRefused(): void {
  const result = assetImageUploadFieldsSchema.safeParse({ caption: "x".repeat(1001) });
  assert(result.success === false, "expected a 1001-char caption to be refused");
}

export function assertUploadFieldsExtraFieldIsRefused(): void {
  const result = assetImageUploadFieldsSchema.safeParse({ caption: "x", extra: 1 });
  assert(result.success === false, "expected an extra field to be refused (.strict())");
}

export function assertUploadFieldsWithoutCaptionParses(): void {
  const result = assetImageUploadFieldsSchema.safeParse({});
  assert(result.success === true, `expected an empty body to parse (caption optional), got ${JSON.stringify(result)}`);
}

export function assertFilenameOverlongIsRefused(): void {
  const result = assetImageFilenameSchema.safeParse("x".repeat(256));
  assert(result.success === false, "expected a 256-char filename to be refused");
}

export function assertBlankFilenameIsRefused(): void {
  const result = assetImageFilenameSchema.safeParse("  ");
  assert(result.success === false, "expected a whitespace-only filename to be refused");
}

/**
 * Post-merge sweep (security Low) — the request-path mirror of the shared
 * DTO's control-character refusal.
 *
 * The control character is **interior** on purpose: `assetImageFilenameSchema`
 * trims first, so a trailing `\r\n` never reaches the pattern and a row that
 * put it there would gate nothing. The two accepted rows are the positive
 * controls — a pattern that refused everything outside ASCII would pass both
 * refusals and break the names `decodeMulterFilename` exists to recover.
 */
export const REQUEST_CONTROL_CHARACTER_ROWS = [
  { label: "a filename with an interior CR LF is refused", value: "a\r\nb.png", field: "filename", accepted: false },
  { label: "a caption with BEL is refused", value: "alarm", field: "caption", accepted: false },
  { label: "café.png is accepted", value: "café.png", field: "filename", accepted: true },
  // The emoji is written as an escape, not a literal glyph (§4.5's no-emoji rule).
  { label: "a caption with an emoji is accepted", value: "Pump room \u{1F6B0}", field: "caption", accepted: true },
] as const;

export function assertRequestSchemaControlCharacterRow(
  row: (typeof REQUEST_CONTROL_CHARACTER_ROWS)[number],
): void {
  const result =
    row.field === "filename"
      ? assetImageFilenameSchema.safeParse(row.value)
      : assetImageUploadFieldsSchema.safeParse({ caption: row.value });
  assert(
    result.success === row.accepted,
    `${row.label}: safeParse returned success=${result.success}`,
  );
}

export function assertFilenameTrims(): void {
  const result = assetImageFilenameSchema.safeParse(" a.png ");
  assert(
    result.success === true && result.data === "a.png",
    `expected " a.png " to trim to "a.png", got ${JSON.stringify(result)}`,
  );
}
