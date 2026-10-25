import { MAX_COPILOT_ATTACHMENT_BYTES, MAX_IMPORT_FILE_BYTES, MAX_MIMIC_SYMBOL_SVG_BYTES } from "@bms/shared/contracts";

/**
 * `F3.87` PR 8 (ADR 0099 Amendment 3 A4, A7) — the dock's attachment helpers:
 * the picker's own refusals and the stored placeholder lines of a user row.
 * Moved out of `copilot-dock.tsx` (`F4.245`) to keep it under the 1000-line
 * cap; the server re-checks every limit.
 */

/** `F3.87` PR 8: the file types a turn may carry, by extension (the server decides by the bytes). */
export const ATTACHMENT_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".pdf", ".svg", ".csv", ".xlsx"] as const;

/** `F4.283` (Amendment 8 Q20): the data files a turn carries and never sends to the provider. */
export const CARRY_ONLY_EXTENSIONS = [".csv", ".xlsx"] as const;

/** Owner ruling 2026-10-24 (drafter choice 8): the A7 sentence's addition for a CSV or XLSX. */
export const CARRY_ONLY_SENTENCE = "A CSV or XLSX file stays in this browser and is not sent to the provider.";

const isCarryOnlyName = (name: string): boolean => CARRY_ONLY_EXTENSIONS.some((ext) => name.endsWith(ext));

/** The sentence the attach control's label and title carry (Amendment 3 A7). */
export function unscrubbedSentence(organization: string): string {
  return `The file goes to ${organization}'s AI provider as it is, unscrubbed.`;
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** Why the picker refuses this file, or `null` when it may be attached. The count is the caller's check. */
export function attachmentProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `"${file.name}" is not a PNG, JPEG, WebP, PDF, SVG, CSV or XLSX file.`;
  }
  const max = name.endsWith(".svg")
    ? MAX_MIMIC_SYMBOL_SVG_BYTES
    : isCarryOnlyName(name)
      ? MAX_IMPORT_FILE_BYTES
      : MAX_COPILOT_ATTACHMENT_BYTES;
  return file.size > max ? `"${file.name}" is larger than ${sizeLabel(max)}.` : null;
}

/** One stored placeholder line, as `attachmentPlaceholder` writes it on the server (`F3.87` PR 7). */
const ATTACHMENT_RECORD = /^\[Attachment \d+ of \d+: .*; not stored\]$/;

/**
 * A stored user row split into the typed text and its placeholder lines: the
 * lines after the last blank line, when every one of them is a placeholder.
 * A row with none is all text.
 */
export function splitAttachmentRecords(content: string): { text: string; records: string[] } {
  const cut = content.lastIndexOf("\n\n");
  if (cut < 0) return { text: content, records: [] };
  const lines = content.slice(cut + 2).split("\n");
  if (!lines.every((line) => ATTACHMENT_RECORD.test(line))) return { text: content, records: [] };
  return { text: content.slice(0, cut), records: lines };
}
