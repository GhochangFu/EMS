import { createHash } from "node:crypto";

import { mimicSymbolFilenameSchema } from "@bms/shared";
import type { CatalogEntry } from "@bms/shared/copilot";

import { parseSvgSymbol, SvgSymbolRefusal } from "../mimic-symbol-libraries/svg-symbol-parser";

/** `F3.87` PR 6a: the model named an attached file, and this turn carries none (attachments arrive in PR 7). */
export const UPLOAD_NEEDS_ATTACHMENT_ERROR = "Attach the .svg file to your message, then propose the symbol again.";
export const UPLOAD_TOO_LARGE_ERROR = "The SVG is larger than the symbol upload allows.";
export const UPLOAD_NO_SVG_ERROR = "Give the symbol's SVG: the svg field is missing.";

/** One file a turn carries, as PR 7 will hand it to the propose step (an attached `.svg`, as text). */
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
  attachments: readonly UploadAttachment[] = [],
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
  if (!filename.success) return { ok: false, error: "The SVG file's name cannot be stored." };
  const body: Record<string, unknown> = {};
  for (const key of ["name", "label", "group"] as const) {
    if (typeof modelBody[key] === "string") body[key] = modelBody[key];
  }
  body.filename = filename.data;
  body.fileSha256 = createHash("sha256").update(buffer).digest("hex");
  body.svgText = svgText;
  return { ok: true, body };
}
