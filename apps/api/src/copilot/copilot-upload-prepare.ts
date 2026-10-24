import { createHash } from "node:crypto";

import { mimicSymbolFilenameSchema } from "@bms/shared";
import { bodyFieldsOf, type CatalogEntry } from "@bms/shared/copilot";

import { parseSvgSymbol, SvgSymbolRefusal } from "../mimic-symbol-libraries/svg-symbol-parser";
import type { TurnAttachment } from "./copilot-attachments";

/** `F3.87` PR 6a/7: the model named an attached file, and this turn carries no SVG at that index. */
export const UPLOAD_NEEDS_ATTACHMENT_ERROR = "Attach the .svg file to your message, then propose the symbol again.";
export const UPLOAD_TOO_LARGE_ERROR = "The SVG is larger than the symbol upload allows.";
export const UPLOAD_NO_SVG_ERROR = "Give the symbol's SVG: the svg field is missing.";
export const UPLOAD_BAD_FILENAME_ERROR = "Rename the SVG file without quotes or slashes, then attach it again.";

/** One file a turn carries, as the propose step receives it (an attached `.svg`, as text). */
export type UploadAttachment = { readonly filename: string; readonly svgText: string };

export type PreparedUpload = { readonly ok: true; readonly body: Record<string, unknown> } | { readonly ok: false; readonly error: string };

/**
 * `F3.87` PR 6a (ADR 0099 Amendment 3 A3, plan §8.2) — turns the model's body
 * for an `upload` entry into the body the pending row stores:
 *
 * - the SVG source is the model's own text (`svg: { kind: "text" }`) or an
 *   attached file of this turn (`svg: { kind: "attachment", index }`);
 * - it must fit `upload.maxBytes` and pass the same parser the route runs
 *   (`parseSvgSymbol`), so a card that cannot apply is never shown — the
 *   parser's refusal is the tool's error;
 * - the stored body is `{ name?, label?, group?, filename, fileSha256,
 *   svgText }`: the multipart text fields as the browser will send them, the
 *   file's name and the SHA-256 of its bytes, and the text itself under the
 *   entry's `cardOnly` key, which the hash leaves out.
 *
 * The route parses the bytes again on Confirm (decision 4.5), and the
 * interceptor's route stage hashes the bytes it receives.
 */
export function prepareUpload(
  entry: Pick<CatalogEntry, "upload">,
  modelBody: Readonly<Record<string, unknown>>,
  // `F3.87` PR 7: one slot per attached file, by position; `undefined` where the file is not an SVG.
  attachments: readonly (UploadAttachment | undefined)[] = [],
): PreparedUpload {
  if (entry.upload === undefined) return { ok: false, error: UPLOAD_NO_SVG_ERROR };
  const svg = modelBody.svg as { kind?: unknown; text?: unknown; index?: unknown } | undefined;
  let svgText: string;
  let attachedName: string | null = null;
  if (svg?.kind === "text" && typeof svg.text === "string") {
    svgText = svg.text;
  } else if (svg?.kind === "attachment" && typeof svg.index === "number") {
    const attached = attachments[svg.index - 1];
    if (attached === undefined) return { ok: false, error: UPLOAD_NEEDS_ATTACHMENT_ERROR };
    svgText = attached.svgText;
    attachedName = attached.filename;
  } else {
    return { ok: false, error: UPLOAD_NO_SVG_ERROR };
  }
  const buffer = Buffer.from(svgText, "utf8");
  if (buffer.byteLength > entry.upload.maxBytes) return { ok: false, error: UPLOAD_TOO_LARGE_ERROR };
  try {
    parseSvgSymbol(buffer);
  } catch (error) {
    if (error instanceof SvgSymbolRefusal) return { ok: false, error: `The SVG cannot be a symbol: ${error.reason}` };
    throw error;
  }
  const name = typeof modelBody.name === "string" && modelBody.name !== "" ? modelBody.name : null;
  const filename = mimicSymbolFilenameSchema.safeParse(attachedName ?? `${name ?? "symbol"}.svg`);
  // A quote or a path separator does not survive the browser's multipart encoder and multer
  // unchanged, so the Confirm would hash another name and could never apply.
  if (!filename.success || /["/\\]/.test(filename.data)) return { ok: false, error: UPLOAD_BAD_FILENAME_ERROR };
  const body: Record<string, unknown> = {};
  for (const key of ["name", "label", "group"] as const) {
    if (typeof modelBody[key] === "string") body[key] = modelBody[key];
  }
  body.filename = filename.data;
  body.fileSha256 = createHash("sha256").update(buffer).digest("hex");
  body.svgText = svgText;
  return { ok: true, body };
}

/** `F4.283` (Amendment 8 Q19): the model named an attached file, and this turn carries none at that index. */
export const UPLOAD_NEEDS_FILE_ERROR = "Attach the file to your message, then propose again.";
export const UPLOAD_FILE_TOO_LARGE_ERROR = "The attached file is larger than this upload allows.";

/** The sentence for a file of a type the entry does not take. */
export function uploadWrongTypeError(accepts: readonly string[]): string {
  return `The attached file cannot be used here: attach a file of type ${accepts.join(", ")}.`;
}

/** The facts of one attached file the file-upload step reads; the bytes never reach the stored body. */
export type FileUploadAttachment = Pick<TurnAttachment, "index" | "filename" | "mediaType" | "byteSize" | "sha256" | "data">;

export type PreparedFileUpload =
  | { readonly ok: true; readonly body: Record<string, unknown>; readonly attachment: FileUploadAttachment }
  | { readonly ok: false; readonly error: string };

/** `F4.283` (Q21): the entries whose stored body fixes `conflictPolicy: "reject"`. */
const REJECT_ONLY_UPLOADS: ReadonlySet<string> = new Set(["telemetry.import"]);

/**
 * `F4.283` (ADR 0099 Amendment 8 Q18, Q19) — turns the model's body for a
 * `kind: "file"` upload entry into the body the pending row stores:
 *
 * - the file is the turn's attachment at `file.index` (1-based); a turn with
 *   no file there — a follow-up turn carries none — is refused;
 * - its type, sniffed from the bytes, must be one the entry `accepts`, and it
 *   must fit `upload.maxBytes`;
 * - the stored body is every string body field the model sent (the multipart
 *   text fields as the browser will send them), the file's name and the
 *   SHA-256 the inspection computed. Never the bytes: the browser keeps them.
 *   The import writes `conflictPolicy: "reject"` explicitly (Q21).
 *
 * The attachment comes back beside the body, so the proposal check reads its
 * bytes without the row storing them.
 */
export function prepareFileUpload(
  entry: Pick<CatalogEntry, "id" | "body" | "upload">,
  modelBody: Readonly<Record<string, unknown>>,
  attachments: readonly FileUploadAttachment[] | undefined,
): PreparedFileUpload {
  if (entry.upload === undefined || entry.upload.kind !== "file") return { ok: false, error: UPLOAD_NEEDS_FILE_ERROR };
  const ref = modelBody.file as { kind?: unknown; index?: unknown } | undefined;
  const index = ref?.kind === "attachment" && typeof ref.index === "number" ? ref.index : null;
  const attachment = index === null ? undefined : (attachments ?? []).find((candidate) => candidate.index === index);
  if (attachment === undefined) return { ok: false, error: UPLOAD_NEEDS_FILE_ERROR };
  if (!entry.upload.accepts.includes(attachment.mediaType)) return { ok: false, error: uploadWrongTypeError(entry.upload.accepts) };
  if (attachment.byteSize > entry.upload.maxBytes) return { ok: false, error: UPLOAD_FILE_TOO_LARGE_ERROR };
  const body: Record<string, unknown> = {};
  for (const field of bodyFieldsOf(entry.body)) {
    if (typeof modelBody[field] === "string") body[field] = modelBody[field];
  }
  if (REJECT_ONLY_UPLOADS.has(entry.id)) body.conflictPolicy = "reject";
  body.filename = attachment.filename;
  body.fileSha256 = attachment.sha256;
  return { ok: true, body, attachment };
}
