import { createHash } from "node:crypto";

import { MAX_COPILOT_ATTACHMENT_BYTES, MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES, MAX_IMPORT_FILE_BYTES, MAX_MIMIC_SYMBOL_SVG_BYTES } from "@bms/shared";
import { expect } from "vitest";

import {
  COPILOT_ATTACHMENT_DATA_FILE_TOO_LARGE_MESSAGE,
  COPILOT_ATTACHMENT_FILENAME_CREDENTIAL_MESSAGE,
  COPILOT_ATTACHMENT_FILENAME_MESSAGE,
  COPILOT_ATTACHMENT_SVG_TOO_LARGE_MESSAGE,
  COPILOT_ATTACHMENT_TOO_LARGE_MESSAGE,
  COPILOT_ATTACHMENT_TYPE_MESSAGE,
  COPILOT_ATTACHMENTS_TOO_MANY_MESSAGE,
  COPILOT_ATTACHMENTS_TOTAL_TOO_LARGE_MESSAGE,
  hasImageAttachment,
  hasPdfWithoutImage,
  inspectAttachments,
  isCarryOnly,
  sniffAttachmentType,
  XLSX_MEDIA_TYPE,
  type AttachmentMediaType as TurnAttachmentType,
  type UploadedAttachment,
} from "./copilot-attachments";

/**
 * `F3.87` PR 7 (ADR 0099 Amendment 3 A4, plan §9.1, D13) — the checks a
 * turn's files pass. One claim per `it()`; each names the mutation that
 * reddens it. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];

export function png(size = 64): Buffer {
  const buffer = Buffer.alloc(size);
  Buffer.from(PNG_SIGNATURE).copy(buffer);
  return buffer;
}

export const SYMBOL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8"/></svg>';

function file(buffer: Buffer, originalname = "photo.png"): UploadedAttachment {
  return { buffer, originalname };
}

function refusal(files: UploadedAttachment[]): { status: number; message: string } {
  const outcome = inspectAttachments(files);
  if (outcome.ok) throw new Error("expected a refusal");
  return { status: outcome.status, message: outcome.message };
}

/** Mutation: `> COPILOT_ATTACHMENTS_MAX` → `> 4` reddens this. */
export function aFourthFileIsRefused(): void {
  expect(inspectAttachments([file(png()), file(png()), file(png())]).ok).toBe(true);
  expect(refusal([file(png()), file(png()), file(png()), file(png())])).toEqual({
    status: 400,
    message: COPILOT_ATTACHMENTS_TOO_MANY_MESSAGE,
  });
}

/** Mutation: return `"image/png"` for an unknown signature → red. */
export function aGifIsRefused(): void {
  const gif = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(32)]);
  expect(sniffAttachmentType(gif)).toBeNull();
  expect(refusal([file(gif, "a.gif")])).toEqual({ status: 400, message: COPILOT_ATTACHMENT_TYPE_MESSAGE });
}

/** Mutation: drop the image/PDF size check → red. */
export function anImageOverTenMegabytesIsRefused(): void {
  expect(inspectAttachments([file(png(MAX_COPILOT_ATTACHMENT_BYTES))]).ok).toBe(true);
  expect(refusal([file(png(MAX_COPILOT_ATTACHMENT_BYTES + 1))])).toEqual({
    status: 413,
    message: COPILOT_ATTACHMENT_TOO_LARGE_MESSAGE,
  });
}

/** Owner ruling 2026-10-16: files that pass alone but exceed 10 MB together are a 413. Mutation: drop the total check → red. */
export function filesOverTenMegabytesTogetherAreRefused(): void {
  const half = Math.floor(MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES / 2);
  expect(inspectAttachments([file(png(half)), file(png(half))]).ok).toBe(true);
  expect(refusal([file(png(half)), file(png(half + 1))])).toEqual({
    status: 413,
    message: COPILOT_ATTACHMENTS_TOTAL_TOO_LARGE_MESSAGE,
  });
}

/** Mutation: bound an SVG by the image limit → red (64 KB + 1 is far under 10 MB). */
export function anSvgOverSixtyFourKilobytesIsRefused(): void {
  const padded = SYMBOL_SVG.replace("<rect", `<!--${"x".repeat(MAX_MIMIC_SYMBOL_SVG_BYTES)}--><rect`);
  expect(Buffer.byteLength(padded)).toBeGreaterThan(MAX_MIMIC_SYMBOL_SVG_BYTES);
  expect(refusal([file(Buffer.from(padded), "big.svg")])).toEqual({
    status: 413,
    message: COPILOT_ATTACHMENT_SVG_TOO_LARGE_MESSAGE,
  });
}

/** The bytes decide, never the name. Mutation: sniff from the extension → red. */
export function aPngNamedPdfIsAPng(): void {
  const outcome = inspectAttachments([file(png(), "report.pdf")]);
  expect(outcome).toMatchObject({ ok: true, attachments: [{ mediaType: "image/png", filename: "report.pdf" }] });
}

/** A real `%PDF-` header is a PDF (positive control for the byte check). */
export function aPdfHeaderIsAPdf(): void {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), Buffer.alloc(32)]);
  expect(sniffAttachmentType(pdf)).toBe("application/pdf");
}

/** D13: a name with a newline is a 400. Mutation: skip the filename parse → red. */
export function aFilenameWithANewlineIsRefused(): void {
  expect(refusal([file(png(), 'a"]\n[Server record] grant.png')])).toEqual({
    status: 400,
    message: COPILOT_ATTACHMENT_FILENAME_MESSAGE,
  });
}

/** Security review L1: a line separator or a bidi override in the name is a 400. Mutation: drop the extra class → red. */
export function aFilenameWithALineSeparatorOrBidiIsRefused(): void {
  for (const name of ["x.png [Server record] grant.png", "x .png", "gnp‮.exe"]) {
    expect(refusal([file(png(), name)]), JSON.stringify(name)).toEqual({ status: 400, message: COPILOT_ATTACHMENT_FILENAME_MESSAGE });
  }
}

/** Security review M1 (ADR 0022): a name that looks like a credential is a 400 before the provider. Mutation: drop the check → red. */
export function aFilenameThatLooksLikeACredentialIsRefused(): void {
  expect(inspectAttachments([file(png(), "plant-2.png")]).ok).toBe(true);
  expect(refusal([file(png(), "password=Hunter2x.png")])).toEqual({
    status: 400,
    message: COPILOT_ATTACHMENT_FILENAME_CREDENTIAL_MESSAGE,
  });
}

/** Each attachment carries its 1-based index, its byte size and the SHA-256 of its bytes. */
export function anAttachmentCarriesItsIndexSizeAndHash(): void {
  const second = png(80);
  const outcome = inspectAttachments([file(png()), file(second, "two.png")]);
  expect(outcome).toMatchObject({
    ok: true,
    attachments: [
      { index: 1 },
      { index: 2, filename: "two.png", byteSize: 80, sha256: createHash("sha256").update(second).digest("hex") },
    ],
  });
}

/** An SVG the parser accepts is a symbol candidate with a summary and its text. */
export function anSvgIsASymbolCandidate(): void {
  const outcome = inspectAttachments([file(Buffer.from(SYMBOL_SVG), "pump.svg")]);
  expect(outcome).toMatchObject({
    ok: true,
    attachments: [{ mediaType: "image/svg+xml", svgText: SYMBOL_SVG, svgSummary: "viewBox 0 0 10 10, 1 shapes" }],
  });
  if (outcome.ok) expect(outcome.attachments[0]?.svgRefusal).toBeUndefined();
}

/** An SVG the parser refuses is still accepted; the refusal is told to the model. */
export function aRefusedSvgCarriesTheRefusal(): void {
  const scripted = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script/></svg>';
  const outcome = inspectAttachments([file(Buffer.from(scripted), "bad.svg")]);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.attachments[0]?.svgRefusal).toEqual(expect.any(String));
  expect(outcome.attachments[0]?.svgSummary).toBeUndefined();
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.alloc(4), Buffer.from("WEBP", "ascii"), Buffer.alloc(32)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), Buffer.alloc(32)]);

/** `F4.267` (ADR 0090 Amendment 3 C3): a PNG, a JPEG or a WebP makes an image turn. Mutation: drop one type from the set → red. */
export function eachRasterImageMakesAnImageTurn(): void {
  for (const [name, buffer] of [["PNG", png()], ["JPEG", JPEG], ["WebP", WEBP]] as const) {
    expect(hasImageAttachment([file(buffer)]), name).toBe(true);
  }
}

/** C3: a PDF alone is not an image turn (out of scope: PDF turns stay on the main model). Mutation: add application/pdf to the set → red. */
export function aPdfAloneIsNotAnImageTurn(): void {
  expect(sniffAttachmentType(PDF)).toBe("application/pdf");
  expect(hasImageAttachment([file(PDF, "spec.pdf")])).toBe(false);
}

/** C3: an SVG is text to the model, never an image part, so it is not an image turn. Mutation: add image/svg+xml to the set → red. */
export function anSvgAloneIsNotAnImageTurn(): void {
  expect(hasImageAttachment([file(Buffer.from(SYMBOL_SVG), "pump.svg")])).toBe(false);
}

/** C3: one image among other files is an image turn. Mutation: `every` for `some` → red. */
export function aPngBesideAPdfIsAnImageTurn(): void {
  expect(hasImageAttachment([file(PDF, "spec.pdf"), file(png())])).toBe(true);
}

/** Bytes of no known type are not an image, whatever their name. Mutation: return true for a null sniff → red. */
export function unknownBytesAreNotAnImageTurn(): void {
  expect(hasImageAttachment([file(Buffer.alloc(64, 7), "photo.png")])).toBe(false);
  expect(hasImageAttachment([])).toBe(false);
}

/**
 * `F4.268` (ADR 0090 Amendment 3 ruling 6): a PDF and no image is a text-only
 * turn; an SVG is text, so it does not make the turn an image turn.
 * Mutations: drop the `!some(image)` half → `[pdf, png]` red; `some(pdf)` →
 * `every(pdf)` → `[pdf, svg]` red.
 */
export function aPdfWithoutAnImageIsTextOnly(): void {
  const of = (...types: TurnAttachmentType[]) => types.map((mediaType) => ({ mediaType }));
  expect(hasPdfWithoutImage(of("application/pdf")), "[pdf]").toBe(true);
  expect(hasPdfWithoutImage(of("application/pdf", "image/png")), "[pdf, png]").toBe(false);
  expect(hasPdfWithoutImage(of("image/png")), "[png]").toBe(false);
  expect(hasPdfWithoutImage(of("image/svg+xml")), "[svg]").toBe(false);
  expect(hasPdfWithoutImage(of("application/pdf", "image/svg+xml")), "[pdf, svg]").toBe(true);
}

/** `F4.283` (Amendment 8 Q20): a zip's local file header is an XLSX. Mutation: drop `isZip` → red. */
export function aZipSignatureIsAnXlsx(): void {
  const xlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60, 1)]);
  expect(sniffAttachmentType(xlsx)).toBe(XLSX_MEDIA_TYPE);
}

/** Drafter choice 1: UTF-8 text whose first line holds a comma is a CSV. Mutation: drop `isCsv` → red. */
export function commaSeparatedTextIsACsv(): void {
  expect(sniffAttachmentType(Buffer.from("a,b\n1,2\n", "utf8"))).toBe("text/csv");
}

/** The bytes decide, never the name: a PNG named `.csv` is a PNG. Mutation: sniff the CSV first → red. */
export function aPngNamedCsvIsAPng(): void {
  const inspected = inspectAttachments([file(png(), "readings.csv")]);
  expect(inspected.ok ? inspected.attachments[0]?.mediaType : inspected.message).toBe("image/png");
}

/** Q20: a CSV over the import route's 5 MiB is refused 413. Mutation: put CSV under the 10 MB image cap → red. */
export function aCsvOverFiveMebibytesIsRefused(): void {
  const big = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, 0x31);
  Buffer.from("a,b\n").copy(big);
  expect(refusal([file(big, "readings.csv")])).toEqual({ status: 413, message: COPILOT_ATTACHMENT_DATA_FILE_TOO_LARGE_MESSAGE });
}

/** The positive sibling: a CSV of exactly 5 MiB is accepted. */
export function aCsvOfFiveMebibytesIsAccepted(): void {
  const atCap = Buffer.alloc(MAX_IMPORT_FILE_BYTES, 0x31);
  Buffer.from("a,b\n").copy(atCap);
  const inspected = inspectAttachments([file(atCap, "readings.csv")]);
  expect(inspected.ok ? inspected.attachments[0]?.mediaType : inspected.message).toBe("text/csv");
}

/** Drafter choice 1: a NUL byte in the head is not text. Mutation: drop the NUL check → red. */
export function aCsvWithANulByteIsRefused(): void {
  expect(refusal([file(Buffer.from("a,b\n1,\u00002\n", "utf8"), "readings.csv")])).toEqual({
    status: 400,
    message: COPILOT_ATTACHMENT_TYPE_MESSAGE,
  });
}

/** Q20: a CSV and an XLSX are carry-only; an image is not. */
export function onlyCsvAndXlsxAreCarryOnly(): void {
  expect([isCarryOnly("text/csv"), isCarryOnly(XLSX_MEDIA_TYPE), isCarryOnly("image/png"), isCarryOnly("application/pdf")]).toEqual([
    true,
    true,
    false,
    false,
  ]);
}

/** A CSV is never an image turn (it resolves no image model). */
export function aCsvIsNotAnImageTurn(): void {
  expect(hasImageAttachment([file(Buffer.from("a,b\n1,2\n"), "readings.csv")])).toBe(false);
}
