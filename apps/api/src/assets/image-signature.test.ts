import { describe, it } from "vitest";

import {
  assertBlankFilenameIsRefused,
  assertEmptyBufferIsNull,
  assertFilenameOverlongIsRefused,
  assertFilenameTrims,
  assertGifHeaderIsNull,
  assertJpegPrefixSniffsAsJpeg,
  assertPngSignatureSniffsAsPng,
  assertReturnedValueIsAMemberOfTheSharedEnum,
  assertRiffWaveIsNull,
  assertRiffWebpSniffsAsWebp,
  assertShortPngPrefixIsNull,
  assertUploadFieldsBlankCaptionParses,
  assertUploadFieldsExtraFieldIsRefused,
  assertUploadFieldsOverlongCaptionIsRefused,
  assertUploadFieldsWithoutCaptionParses,
} from "./image-signature.spec";

/**
 * `F3.4` (ADR 0066 Amendment 3) — Vitest entry point for the image-signature
 * sniff and the two multipart request schemas. Assertions live in the
 * sibling `.spec` (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.4 — sniffImageContentType", () => {
  it("sniffs a JPEG prefix as image/jpeg", () => {
    assertJpegPrefixSniffsAsJpeg();
  });

  it("sniffs the 8-byte PNG signature as image/png", () => {
    assertPngSignatureSniffsAsPng();
  });

  it("sniffs RIFF/????/WEBP as image/webp", () => {
    assertRiffWebpSniffsAsWebp();
  });

  it("returns null for RIFF/????/WAVE (proves bytes 8-11 are read)", () => {
    assertRiffWaveIsNull();
  });

  it("returns null for an 11-byte PNG prefix", () => {
    assertShortPngPrefixIsNull();
  });

  it("returns null for a GIF header", () => {
    assertGifHeaderIsNull();
  });

  it("returns null for an empty buffer", () => {
    assertEmptyBufferIsNull();
  });

  it("returns a value that is a member of ASSET_IMAGE_CONTENT_TYPES", () => {
    assertReturnedValueIsAMemberOfTheSharedEnum();
  });
});

describe("F3.4 — assetImageUploadFieldsSchema / assetImageFilenameSchema", () => {
  it("parses a blank caption to \"\"", () => {
    assertUploadFieldsBlankCaptionParses();
  });

  it("refuses a 1001-char caption", () => {
    assertUploadFieldsOverlongCaptionIsRefused();
  });

  it("refuses an extra field (.strict())", () => {
    assertUploadFieldsExtraFieldIsRefused();
  });

  it("parses an empty body (caption optional)", () => {
    assertUploadFieldsWithoutCaptionParses();
  });

  it("refuses a 256-char filename", () => {
    assertFilenameOverlongIsRefused();
  });

  it("refuses a whitespace-only filename", () => {
    assertBlankFilenameIsRefused();
  });

  it("trims a filename", () => {
    assertFilenameTrims();
  });
});
