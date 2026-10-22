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
 * worker as a separate `.js` asset (`?worker&url`; nginx serves `.mjs` as
 * `application/octet-stream`, which a module worker refuses), so the main
 * bundle does not grow (decision 5). Its wasm decoders, standard fonts and CMaps
 * are same-origin static files under `/pdfjs/`, copied there before `vite dev`
 * and `vite build` by `scripts/copy-pdfjs-assets.mjs`; no CDN is read.
 *
 * CVE-2024-4367 was the font glyph path compiling code with `new Function`; it
 * has used no `eval` since `4.2.67`, so `5.4.394` is not exposed to it. In
 * `5.4.394` `isEvalSupported` controls only the Type 4 PostScript function
 * compiler, and `false` is set as defence in depth.
 *
 * Bounds (decision 3): the longer side is at most 2048 px; a PNG above
 * `MAX_COPILOT_ATTACHMENT_BYTES` is rendered again smaller, down to 1024 px,
 * after which the picker refuses the file. A PDF `pdfjs-dist` cannot open
 * (damaged, or protected by a password) is refused with one sentence
 * (decision 4); no password is asked for. One decoded image is at most
 * `PDF_MAX_IMAGE_PIXELS`, and the open plus the render are refused after
 * `PDF_RENDER_TIMEOUT_MS`.
 */

/** The longer side of the first render, in pixels (ADR 0105 decision 3). */
export const PDF_PAGE_MAX_SIDE = 2048;
/** The longer side under which the downscale loop gives up and the picker refuses the file. */
export const PDF_PAGE_MIN_SIDE = 1024;
/** Each render after the first is this fraction of the previous one's longer side. */
const DOWNSCALE_STEP = 0.75;
/** `maxImageSize`: the most pixels one image in the page may decode to (ADR 0105 decision 3). */
export const PDF_MAX_IMAGE_PIXELS = 4096 * 4096;
/** The open plus the render of page 1 are refused after this many milliseconds (ADR 0105 decision 3). */
export const PDF_RENDER_TIMEOUT_MS = 20_000;
/** The same-origin base of the copied `pdfjs-dist` assets; each URL ends in a slash, as `pdfjs-dist` appends a file name. */
export const PDFJS_ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

/** The part of a `pdfjs-dist` page this file uses; the real module must fit it with no cast. */
export type PdfPageLike = {
  getViewport(params: { scale: number }): PageViewport;
  render(params: { canvas: HTMLCanvasElement; viewport: PageViewport }): {
    promise: Promise<unknown>;
  };
};

/** What this file passes to `getDocument`: the bytes, the bounds and the same-origin asset URLs. */
export type PdfOpenParams = {
  data: Uint8Array;
  isEvalSupported: false;
  maxImageSize: number;
  wasmUrl: string;
  standardFontDataUrl: string;
  cMapUrl: string;
  cMapPacked: true;
};

/** The part of the `pdfjs-dist` module this file uses: open a document from bytes. */
export type PdfjsLike = {
  getDocument(params: PdfOpenParams): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPageLike> }>;
    destroy(): Promise<void>;
  };
};

/** The seam a spec stubs: the module loader, the canvas the page is drawn on, and the time limit. */
export type PdfPageDeps = {
  loadPdfjs: () => Promise<PdfjsLike>;
  createCanvas: () => HTMLCanvasElement;
  timeoutMs: number;
};

async function loadPdfjs(): Promise<PdfjsLike> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    // `?worker&url`: Vite bundles the worker as an ES module named `.js` (`worker.format: "es"`).
    import("pdfjs-dist/build/pdf.worker.min.mjs?worker&url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

const BROWSER_DEPS: PdfPageDeps = {
  loadPdfjs,
  createCanvas: () => document.createElement("canvas"),
  timeoutMs: PDF_RENDER_TIMEOUT_MS,
};

export type PdfPageResult = { ok: true; png: File; pageCount: number } | { ok: false; problem: string };

const pageCounts = new WeakMap<File, number>();

/**
 * The page count of the PDF a PNG was rendered from, for the chip's
 * `page 1 of N`; `undefined` for any file this module did not render.
 */
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

type Task = ReturnType<PdfjsLike["getDocument"]>;

/** Page 1 of an open document to a PNG, downscaled until it fits, or the refusal. */
async function renderWithin(task: Task, file: File, deps: PdfPageDeps, unreadable: PdfPageResult): Promise<PdfPageResult> {
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
    await page.render({ canvas, viewport }).promise;
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
}

/** Renders page 1 of `file` to a PNG within the bounds, or says why the picker refuses it. */
export async function renderPdfFirstPage(file: File, deps: PdfPageDeps = BROWSER_DEPS): Promise<PdfPageResult> {
  const unreadable = { ok: false as const, problem: `"${file.name}" could not be read as a PDF.` };
  let pdfjs: PdfjsLike;
  try {
    pdfjs = await deps.loadPdfjs();
  } catch {
    // The lazy chunk or the module did not load (a deploy replaced it, the network dropped): not the file's fault.
    return { ok: false, problem: `"${file.name}" could not be prepared: reload the page and try again.` };
  }
  let task: Task | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      maxImageSize: PDF_MAX_IMAGE_PIXELS,
      wasmUrl: `${PDFJS_ASSETS}wasm/`,
      standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
      cMapUrl: `${PDFJS_ASSETS}cmaps/`,
      cMapPacked: true,
    });
    const work = renderWithin(task, file, deps, unreadable);
    // After a timeout the `destroy` below rejects the work; that rejection is expected, not unhandled.
    work.catch(() => undefined);
    const timedOut = new Promise<PdfPageResult>((resolve) => {
      timer = setTimeout(() => resolve(unreadable), deps.timeoutMs);
    });
    return await Promise.race([work, timedOut]);
  } catch {
    return unreadable;
  } finally {
    clearTimeout(timer);
    void task?.destroy().catch(() => undefined);
  }
}

/** Removes one occurrence of each of `done` from `names`: two picks of one name stay two renders. */
export function withoutEach(names: readonly string[], done: readonly string[]): string[] {
  const left = [...names];
  for (const name of done) {
    const i = left.indexOf(name);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
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
