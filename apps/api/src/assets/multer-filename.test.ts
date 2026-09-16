import { describe, it } from "vitest";

import {
  assertACjkNameIsDecodedToItsNinetyCharacters,
  assertALoneLatin1AccentIsKept,
  assertANameAboveLatin1IsKept,
  assertAnAlreadyDecodedCjkNameIsKept,
  assertAnAlreadyDecodedNameIsKept,
  assertAnAsciiNameIsUnchanged,
  assertMojibakeIsDecoded,
  assertTheCjkFixtureArrivesAs270CodeUnits,
  assertTheDecodedCjkNamePassesTheFilenameSchema,
} from "./multer-filename.spec";

/**
 * `F3.4` post-merge sweep (C1) — Vitest entry point for
 * `decodeMulterFilename`. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.4 sweep — decodeMulterFilename", () => {
  it('decodes "cafÃ©.png" to "café.png"', () => {
    assertMojibakeIsDecoded();
  });

  it('leaves "pump.png" unchanged', () => {
    assertAnAsciiNameIsUnchanged();
  });

  it("the CJK fixture really arrives as 270 code units (positive control)", () => {
    assertTheCjkFixtureArrivesAs270CodeUnits();
  });

  it("decodes a 90-character CJK name from its 270 latin1 code units", () => {
    assertACjkNameIsDecodedToItsNinetyCharacters();
  });

  it("makes the CJK name pass assetImageFilenameSchema, which refuses the arriving form", () => {
    assertTheDecodedCjkNamePassesTheFilenameSchema();
  });

  it('keeps an already-UTF-8 "café.png" (the lossless guard)', () => {
    assertAnAlreadyDecodedNameIsKept();
  });

  it("keeps a lone latin1 é, which forms no valid UTF-8 sequence", () => {
    assertALoneLatin1AccentIsKept();
  });

  it("keeps a name carrying a code unit above U+00FF", () => {
    assertANameAboveLatin1IsKept();
  });

  it("keeps an already-decoded CJK name", () => {
    assertAnAlreadyDecodedCjkNameIsKept();
  });
});
