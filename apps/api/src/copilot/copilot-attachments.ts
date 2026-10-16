import { createHash } from "node:crypto";

import {
  COPILOT_ATTACHMENTS_MAX,
  MAX_COPILOT_ATTACHMENT_BYTES,
  MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES,
  MAX_MIMIC_SYMBOL_SVG_BYTES,
  mimicSymbolFilenameSchema,
} from "@bms/shared";

import { sniffImageContentType } from "../assets/image-signature";
import { decodeMulterFilename } from "../assets/multer-filename";
import { looksLikeCredential } from "../llm/credential-detect";
import { parseSvgSymbol, SvgSymbolRefusal } from "../mimic-symbol-libraries/svg-symbol-parser";

/**
 * What multer hands `@UploadedFiles()` — structural, not `Express.Multer.File`, because esbuild
 * emits no `design:paramtypes` (`F4.20`).
 */
export type UploadedAttachment = { readonly buffer: Buffer; readonly originalname: string };

/** The five types a turn accepts, decided from the bytes, never from the client's label or the name. */
export type AttachmentMediaType = "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | "image/svg+xml";

/**
 * One inspected file of a turn. `data` is the bytes for the provider and is
 * never stored; an `.svg` also carries its text, and either a one-line summary
 * of the symbol it would make or the parser's refusal — the model is told
 * which, so it can say why a file cannot become a symbol.
 */
export type TurnAttachment = {
  readonly index: number;
  readonly filename: string;
  readonly mediaType: AttachmentMediaType;
  readonly byteSize: number;
  readonly sha256: string;
  readonly data: Buffer;
  readonly svgText?: string;
  readonly svgSummary?: string;
  readonly svgRefusal?: string;
};

export type AttachmentInspection =
  | { readonly ok: true; readonly attachments: TurnAttachment[] }
  | { readonly ok: false; readonly status: 400 | 413; readonly message: string };

export const COPILOT_ATTACHMENTS_TOO_MANY_MESSAGE = `Attach at most ${COPILOT_ATTACHMENTS_MAX} files to one message.`;
export const COPILOT_ATTACHMENT_TYPE_MESSAGE = "Attach a PNG, JPEG, WebP, PDF or SVG file. Other file types are not read.";
export const COPILOT_ATTACHMENT_TOO_LARGE_MESSAGE = "An image or PDF may be at most 10 MB.";
export const COPILOT_ATTACHMENTS_TOTAL_TOO_LARGE_MESSAGE = "The files of one message may be at most 10 MB together.";
export const COPILOT_ATTACHMENT_SVG_TOO_LARGE_MESSAGE = "An SVG may be at most 64 KB.";
export const COPILOT_ATTACHMENT_FILENAME_MESSAGE = "Rename the file: its name is empty, too long or holds a control character.";
export const COPILOT_ATTACHMENT_FILENAME_CREDENTIAL_MESSAGE =
  "Rename the file: its name looks like it holds a credential, and credentials never go through the copilot.";

/**
 * Line and paragraph separators and format characters (bidi overrides among
 * them): not `\p{Cc}`, so the filename rule lets them through, and
 * `JSON.stringify` leaves them raw — a name could start a new visual line in
 * the placeholder or reverse how its extension reads (security review L1).
 */
const INVISIBLE_BREAKS = /[\p{Zl}\p{Zp}\p{Cf}]/u;

/** The first bytes that decide an SVG: text that opens with `<?xml` or `<svg` and holds an `<svg` element. */
const SVG_SNIFF_BYTES = 1024;

function isPdf(buffer: Buffer): boolean {
  // `%PDF-` compared as bytes, the `image-signature.ts` rule.
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((byte, index) => buffer[index] === byte);
}

function isSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, SVG_SNIFF_BYTES).toString("utf8").replace(/^﻿/, "").trimStart();
  return (head.startsWith("<?xml") || head.startsWith("<svg")) && head.includes("<svg");
}

/** The file's type from its own bytes (`F3.4` R-1): an image signature, `%PDF-`, or SVG text; else null. */
export function sniffAttachmentType(buffer: Buffer): AttachmentMediaType | null {
  const image = sniffImageContentType(buffer);
  if (image !== null) return image;
  if (isPdf(buffer)) return "application/pdf";
  if (isSvg(buffer)) return "image/svg+xml";
  return null;
}

function refused(status: 400 | 413, message: string): AttachmentInspection {
  return { ok: false, status, message };
}

/**
 * `F3.87` PR 7 (ADR 0099 Amendment 3 A4, plan §9.1, D13) — the checks a
 * turn's files pass before the turn is counted: at most three; each one's type
 * from its bytes; an image or PDF at most 10 MB, an SVG at most 64 KB; the
 * name decoded from multer's latin1 and parsed by the symbol filename rule (no
 * control character, so a name can never break the placeholder line). An SVG
 * that the symbol parser refuses is still accepted: the refusal is told to the
 * model as text.
 */
export function inspectAttachments(files: readonly UploadedAttachment[]): AttachmentInspection {
  if (files.length > COPILOT_ATTACHMENTS_MAX) return refused(400, COPILOT_ATTACHMENTS_TOO_MANY_MESSAGE);
  const attachments: TurnAttachment[] = [];
  for (const [position, file] of files.entries()) {
    const mediaType = sniffAttachmentType(file.buffer);
    if (mediaType === null) return refused(400, COPILOT_ATTACHMENT_TYPE_MESSAGE);
    const byteSize = file.buffer.byteLength;
    if (mediaType === "image/svg+xml") {
      if (byteSize > MAX_MIMIC_SYMBOL_SVG_BYTES) return refused(413, COPILOT_ATTACHMENT_SVG_TOO_LARGE_MESSAGE);
    } else if (byteSize > MAX_COPILOT_ATTACHMENT_BYTES) {
      return refused(413, COPILOT_ATTACHMENT_TOO_LARGE_MESSAGE);
    }
    const filename = mimicSymbolFilenameSchema.safeParse(decodeMulterFilename(file.originalname));
    if (!filename.success || INVISIBLE_BREAKS.test(filename.data)) return refused(400, COPILOT_ATTACHMENT_FILENAME_MESSAGE);
    // ADR 0022: a filename is the user's text, and it reaches the provider; the message check never reads it.
    if (looksLikeCredential(filename.data)) return refused(400, COPILOT_ATTACHMENT_FILENAME_CREDENTIAL_MESSAGE);
    const base: TurnAttachment = {
      index: position + 1,
      filename: filename.data,
      mediaType,
      byteSize,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      data: file.buffer,
    };
    attachments.push(mediaType === "image/svg+xml" ? { ...base, ...svgFacts(file.buffer) } : base);
  }
  // Owner ruling 2026-10-16: the files of one turn together fit the proxies' body limit (each file's own limit first).
  const total = attachments.reduce((sum, attachment) => sum + attachment.byteSize, 0);
  if (total > MAX_COPILOT_ATTACHMENTS_TOTAL_BYTES) return refused(413, COPILOT_ATTACHMENTS_TOTAL_TOO_LARGE_MESSAGE);
  return { ok: true, attachments };
}

function svgFacts(buffer: Buffer): Pick<TurnAttachment, "svgText" | "svgSummary" | "svgRefusal"> {
  const svgText = buffer.toString("utf8");
  try {
    const parsed = parseSvgSymbol(buffer);
    return { svgText, svgSummary: `viewBox ${parsed.viewBox.join(" ")}, ${parsed.shapes.length} shapes` };
  } catch (error) {
    if (error instanceof SvgSymbolRefusal) return { svgText, svgRefusal: error.reason };
    throw error;
  }
}
