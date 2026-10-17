/**
 * `F4.268` (ADR 0090 Amendment 3 ruling 6) — a PDF stays on the main model,
 * which gets its extracted text only, so a drawing in it loses its pictures.
 * The composer says so beside the chips when a PDF is chosen.
 */
export const PDF_DRAWING_NOTE = "A drawing in a PDF is read as text only. Send a drawing as an image (PNG, JPEG or WebP).";

/** By extension, as `attachmentProblem` decides; the server decides by the bytes. */
export function hasPdfFile(files: readonly File[]): boolean {
  return files.some((file) => file.name.toLowerCase().endsWith(".pdf"));
}
