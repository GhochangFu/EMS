import { MAX_COPILOT_ATTACHMENT_BYTES } from "@bms/shared/contracts";
import type { PageViewport } from "pdfjs-dist";

import { attachmentProblem, sizeLabel } from "./copilot-attachments";

/**
 * `F4.269` (ADR 0105) — the copilot dock sends a PDF's first page as an image.
 *
 * A PDF that passes the picker's checks is rendered here, in the user's own
 * browser, and its page 1 is attached as a PNG **in place of** the PDF, so the
 * turn carries an image and the API routes it to the organization's vision
 * model (ADR 0090 Amendment 3) as it routes any image. The server is not
 * changed and re-checks every limit (decision 1).
 *
 * `pdfjs-dist` is loaded by a dynamic `import()` on the first PDF pick, with its
 * worker as a separate asset, so the main bundle does not grow (decision 5).
 * `isEvalSupported: false` closes the font-code path of CVE-2024-4367.
 *
 * Bounds (decision 3): the longer side is at most 2048 px; a PNG above
 * `MAX_COPILOT_ATTACHMENT_BYTES` is rendered again smaller, down to 1024 px,
 * after which the picker refuses the file. A PDF `pdfjs-dist` cannot open
 * (damaged, or protected by a password) is refused with one sentence
 * (decision 4); no password is asked for.
 */

/** The longer side of the first render, in pixels (ADR 0105 decision 3). */
export const PDF_PAGE_MAX_SIDE = 2048;
/** The longer side under which the downscale loop gives up and the picker refuses the file. */
export const PDF_PAGE_MIN_SIDE = 1024;
/** Each render after the first is this fraction of the previous one's longer side. */
const DOWNSCALE_STEP = 0.75;

/** The part of a `pdfjs-dist` page this file uses; the real module must fit it with no cast. */
export type PdfPageLike = {
  getViewport(params: { scale: number }): PageViewport;
  render(params: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PageViewport }): {
    promise: Promise<unknown>;
  };
};

/** The part of the `pdfjs-dist` module this file uses: open a document from bytes, never with `eval`. */
export type PdfjsLike = {
  getDocument(params: { data: Uint8Array; isEvalSupported: false }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPageLike> }>;
    destroy(): Promise<void>;
  };
};

/** The seam a jsdom spec stubs: the module loader and the canvas the page is drawn on. */
export type PdfPageDeps = {
  loadPdfjs: () => Promise<PdfjsLike>;
  createCanvas: () => HTMLCanvasElement;
};

async function loadPdfjs(): Promise<PdfjsLike> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

const BROWSER_DEPS: PdfPageDeps = { loadPdfjs, createCanvas: () => document.createElement("canvas") };

export type PdfPageResult = { ok: true; png: File; pageCount: number } | { ok: false; problem: string };

/** The page count of a PNG this file rendered, for the chip; `undefined` for any other file. */
const pageCounts = new WeakMap<File, number>();

export function renderedPageCount(file: File): number | undefined {
  return pageCounts.get(file);
}

/** By extension, as `attachmentProblem` decides; the server decides by the bytes. */
export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".pdf");
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Renders page 1 of `file` to a PNG within the bounds, or says why the picker refuses it. */
export async function renderPdfFirstPage(file: File, deps: PdfPageDeps = BROWSER_DEPS): Promise<PdfPageResult> {
  const unreadable = { ok: false as const, problem: `"${file.name}" could not be read as a PDF.` };
  let task: ReturnType<PdfjsLike["getDocument"]> | null = null;
  try {
    const pdfjs = await deps.loadPdfjs();
    task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const naturalSide = Math.max(natural.width, natural.height);
    if (!(naturalSide > 0)) return unreadable;
    const name = `${file.name.replace(/\.pdf$/i, "")}-page-1.png`;
    for (let side = PDF_PAGE_MAX_SIDE; ; side = Math.max(PDF_PAGE_MIN_SIDE, Math.floor(side * DOWNSCALE_STEP))) {
      const viewport = page.getViewport({ scale: side / naturalSide });
      const canvas = deps.createCanvas();
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (canvasContext === null) return unreadable;
      await page.render({ canvas, canvasContext, viewport }).promise;
      const blob = await toPng(canvas);
      // Free the bitmap now; a 2048 px canvas holds about 16 MB until it is collected.
      canvas.width = 0;
      canvas.height = 0;
      if (blob === null) return unreadable;
      if (blob.size <= MAX_COPILOT_ATTACHMENT_BYTES) {
        const png = new File([blob], name, { type: "image/png" });
        pageCounts.set(png, pdf.numPages);
        return { ok: true, png, pageCount: pdf.numPages };
      }
      if (side <= PDF_PAGE_MIN_SIDE) {
        return { ok: false, problem: `Page 1 of "${file.name}" is larger than ${sizeLabel(MAX_COPILOT_ATTACHMENT_BYTES)} as an image.` };
      }
    }
  } catch {
    return unreadable;
  } finally {
    void task?.destroy().catch(() => undefined);
  }
}

/** One chosen file after the PDF step: the file to attach, or the picker's refusal of it. */
export type PreparedFile = { file: File; problem: string | null };

/**
 * The picker's per-file checks with every PDF that passes them rendered to its
 * page-1 PNG. The count and the 10 MB total stay the caller's, on the PNG.
 */
export async function prepareChosenFiles(chosen: readonly File[]): Promise<PreparedFile[]> {
  const prepared: PreparedFile[] = [];
  for (const file of chosen) {
    const problem = attachmentProblem(file);
    if (problem !== null || !isPdfFile(file)) {
      prepared.push({ file, problem });
      continue;
    }
    const page = await renderPdfFirstPage(file);
    prepared.push(page.ok ? { file: page.png, problem: null } : { file, problem: page.problem });
  }
  return prepared;
}
