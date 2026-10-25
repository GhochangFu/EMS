import { describe, it } from "vitest";

import {
  aFilenameThatLooksLikeACredentialIsRefused,
  aFilenameWithALineSeparatorOrBidiIsRefused,
  aFilenameWithANewlineIsRefused,
  aFourthFileIsRefused,
  aGifIsRefused,
  filesOverTenMegabytesTogetherAreRefused,
  anAttachmentCarriesItsIndexSizeAndHash,
  anImageOverTenMegabytesIsRefused,
  anSvgIsASymbolCandidate,
  anSvgOverSixtyFourKilobytesIsRefused,
  aPdfHeaderIsAPdf,
  aPngNamedPdfIsAPng,
  aRefusedSvgCarriesTheRefusal,
  aPdfAloneIsNotAnImageTurn,
  aPdfWithoutAnImageIsTextOnly,
  aPngBesideAPdfIsAnImageTurn,
  anSvgAloneIsNotAnImageTurn,
  eachRasterImageMakesAnImageTurn,
  unknownBytesAreNotAnImageTurn,
  aCsvIsNotAnImageTurn,
  aCsvOfFiveMebibytesIsAccepted,
  aCsvOverFiveMebibytesIsRefused,
  aCsvWithANulByteIsRefused,
  aPngNamedCsvIsAPng,
  aZipSignatureIsAnXlsx,
  commaSeparatedTextIsACsv,
  onlyCsvAndXlsxAreCarryOnly,
} from "./copilot-attachments.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 7 — a turn's attachments (ADR 0099 Amendment 3 A4, D13)", () => {
  it("refuses a fourth file", () => aFourthFileIsRefused());
  it("refuses a GIF", () => aGifIsRefused());
  it("refuses an image over 10 MB with 413", () => anImageOverTenMegabytesIsRefused());
  it("refuses an SVG over 64 KB with 413", () => anSvgOverSixtyFourKilobytesIsRefused());
  it("refuses files over 10 MB together with 413 (owner ruling 2026-10-16)", () => filesOverTenMegabytesTogetherAreRefused());
  it("takes the type from the bytes, not the name", () => aPngNamedPdfIsAPng());
  it("reads a %PDF- header as a PDF", () => aPdfHeaderIsAPdf());
  it("refuses a filename with a newline", () => aFilenameWithANewlineIsRefused());
  it("gives each file its index, size and sha256", () => anAttachmentCarriesItsIndexSizeAndHash());
  it("refuses a filename with a line separator or a bidi override", () => aFilenameWithALineSeparatorOrBidiIsRefused());
  it("refuses a filename that looks like a credential", () => aFilenameThatLooksLikeACredentialIsRefused());
  it("makes a parsed SVG a symbol candidate", () => anSvgIsASymbolCandidate());
  it("carries the parser's refusal for a refused SVG", () => aRefusedSvgCarriesTheRefusal());
});

describe("F4.267 — which files make an image turn (ADR 0090 Amendment 3 C3)", () => {
  it("a PNG, a JPEG or a WebP makes an image turn", () => eachRasterImageMakesAnImageTurn());
  it("a PDF alone is not an image turn", () => aPdfAloneIsNotAnImageTurn());
  it("an SVG alone is not an image turn", () => anSvgAloneIsNotAnImageTurn());
  it("a PNG beside a PDF is an image turn", () => aPngBesideAPdfIsAnImageTurn());
  it("bytes of no known type are not an image turn", () => unknownBytesAreNotAnImageTurn());
});

describe("F4.268 — a PDF and no image is a text-only turn (ADR 0090 Amendment 3 ruling 6)", () => {
  it("a PDF without an image is text only; an image beside it or no PDF is not", () => aPdfWithoutAnImageIsTextOnly());
});

describe("F4.283 — CSV and XLSX are carry-only attachments (ADR 0099 Amendment 8 Q20)", () => {
  it("reads a zip signature as an XLSX", () => aZipSignatureIsAnXlsx());
  it("reads comma-separated UTF-8 text as a CSV", () => commaSeparatedTextIsACsv());
  it("reads a PNG named .csv as a PNG", () => aPngNamedCsvIsAPng());
  it("refuses a CSV over 5 MiB with 413", () => aCsvOverFiveMebibytesIsRefused());
  it("accepts a CSV of exactly 5 MiB", () => aCsvOfFiveMebibytesIsAccepted());
  it("refuses a CSV with a NUL byte", () => aCsvWithANulByteIsRefused());
  it("makes only CSV and XLSX carry-only", () => onlyCsvAndXlsxAreCarryOnly());
  it("a CSV is not an image turn", () => aCsvIsNotAnImageTurn());
});
