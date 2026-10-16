import { describe, it } from "vitest";

import {
  aFilenameWithANewlineIsRefused,
  aFourthFileIsRefused,
  aGifIsRefused,
  anAttachmentCarriesItsIndexSizeAndHash,
  anImageOverTenMegabytesIsRefused,
  anSvgIsASymbolCandidate,
  anSvgOverSixtyFourKilobytesIsRefused,
  aPdfHeaderIsAPdf,
  aPngNamedPdfIsAPng,
  aRefusedSvgCarriesTheRefusal,
} from "./copilot-attachments.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 7 — a turn's attachments (ADR 0099 Amendment 3 A4, D13)", () => {
  it("refuses a fourth file", () => aFourthFileIsRefused());
  it("refuses a GIF", () => aGifIsRefused());
  it("refuses an image over 10 MB with 413", () => anImageOverTenMegabytesIsRefused());
  it("refuses an SVG over 64 KB with 413", () => anSvgOverSixtyFourKilobytesIsRefused());
  it("takes the type from the bytes, not the name", () => aPngNamedPdfIsAPng());
  it("reads a %PDF- header as a PDF", () => aPdfHeaderIsAPdf());
  it("refuses a filename with a newline", () => aFilenameWithANewlineIsRefused());
  it("gives each file its index, size and sha256", () => anAttachmentCarriesItsIndexSizeAndHash());
  it("makes a parsed SVG a symbol candidate", () => anSvgIsASymbolCandidate());
  it("carries the parser's refusal for a refused SVG", () => aRefusedSvgCarriesTheRefusal());
});
