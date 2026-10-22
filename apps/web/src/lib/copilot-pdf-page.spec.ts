import { expect, vi } from "vitest";

import { MAX_COPILOT_ATTACHMENT_BYTES } from "@bms/shared/contracts";

import {
  PDF_MAX_IMAGE_PIXELS,
  renderedPageCount,
  renderPdfFirstPage,
  withoutEach,
  type PdfjsLike,
  type PdfPageDeps,
} from "./copilot-pdf-page";

/**
 * `F4.269` (ADR 0105 decisions 1, 3, 4, 5) — page 1 of a picked PDF becomes a
 * PNG. `pdfjs-dist` and the canvas are stubbed at the `deps` seam; `node`
 * environment (`File` and `Blob` are globals since Node 20).
 *
 * `isEvalSupported: false` is defence in depth: CVE-2024-4367 was the font
 * glyph path, which has used no `eval` since `pdfjs-dist` `4.2.67`; in
 * `5.4.394` the flag controls only the Type 4 PostScript function compiler.
 */

/** A US Letter page at scale 1: the longer side is the height. */
const LETTER = { width: 612, height: 792 };

type Fake = {
  deps: PdfPageDeps;
  getDocument: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  sides: number[];
};

/**
 * A fake `pdfjs-dist` of `numPages` pages and a fake canvas whose PNG is
 * `pngBytes(longerSide)` bytes long, so a case decides which render fits.
 * `destroy` is a spy, so a case can count that the loading task is freed.
 */
function fake(numPages: number, pngBytes: (side: number) => number): Fake {
  const sides: number[] = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: LETTER.width * scale, height: LETTER.height * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const destroy = vi.fn(async () => undefined);
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages, getPage: async () => page }),
    destroy,
  }));
  const createCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      toBlob(callback: (blob: Blob | null) => void) {
        const side = Math.max(canvas.width, canvas.height);
        sides.push(side);
        const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
        // The size is what the bound reads; no 10 MB buffer is allocated for it.
        Object.defineProperty(blob, "size", { value: pngBytes(side) });
        callback(blob);
      },
    };
    return canvas as unknown as HTMLCanvasElement;
  };
  const loadPdfjs = async () => ({ getDocument }) as unknown as PdfjsLike;
  return { deps: { loadPdfjs, createCanvas, timeoutMs: 1_000 }, getDocument, destroy, sides };
}

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

/** An open that never settles, for the timeout cases. */
function hangs(f: Fake): void {
  f.deps.timeoutMs = 10;
  f.getDocument.mockImplementation(() => ({ promise: new Promise(() => undefined), destroy: f.destroy }));
}

async function rendered(name: string, numPages = 3): Promise<File> {
  const result = await renderPdfFirstPage(pdf(name), fake(numPages, () => 1000).deps);
  if (!result.ok) throw new Error(result.problem);
  return result.png;
}

/** Mutation: name the PNG after the PDF unchanged (`sld.PDF`) → red. */
export async function namesThePngAfterThePdf(): Promise<void> {
  expect((await rendered("sld.PDF")).name).toBe("sld-page-1.png");
}

/** Mutation: type the PNG `application/pdf` → red. */
export async function typesThePngAsImagePng(): Promise<void> {
  expect((await rendered("sld.pdf")).type).toBe("image/png");
}

/** Mutation: return `pageCount: 1` → red. */
export async function returnsThePdfsPageCount(): Promise<void> {
  const result = await renderPdfFirstPage(pdf("sld.pdf"), fake(3, () => 1000).deps);
  expect(result.ok && result.pageCount).toBe(3);
}

/** The chip reads it. Mutation: drop `pageCounts.set` → red. */
export async function recordsThePageCountForTheChip(): Promise<void> {
  expect(renderedPageCount(await rendered("sld.pdf", 7))).toBe(7);
}

/** The first render's longer side is 2048 px. Mutation: `PDF_PAGE_MAX_SIDE = 4096` → red. */
export async function rendersTheLongerSideAt2048(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.sides).toEqual([2048]);
}

/** Defence in depth (decision 5). Mutation: drop `isEvalSupported: false` from the call → red. */
export async function opensTheDocumentWithEvalOff(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.getDocument).toHaveBeenCalledTimes(1);
  expect(f.getDocument.mock.calls[0]?.[0]).toMatchObject({ isEvalSupported: false });
}

/** One decoded image is bounded (decision 3). Mutation: drop `maxImageSize` → red. */
export async function boundsADecodedImageAt4096Squared(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.getDocument.mock.calls[0]?.[0]).toMatchObject({ maxImageSize: PDF_MAX_IMAGE_PIXELS });
  expect(PDF_MAX_IMAGE_PIXELS).toBe(4096 * 4096);
}

/**
 * The wasm, fonts and CMaps come from this origin, each base with a trailing slash (decision 5).
 * Mutation: drop a trailing slash, or `cMapPacked` → red.
 */
export async function readsTheAssetsFromThisOrigin(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.getDocument.mock.calls[0]?.[0]).toMatchObject({
    wasmUrl: "/pdfjs/wasm/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  });
}

/**
 * A PDF `pdfjs-dist` cannot open is refused with the one sentence (decision 4).
 * Mutation: let the rejection escape the `try` → red.
 */
export async function refusesAPdfThatCannotBeOpened(): Promise<void> {
  const f = fake(1, () => 1000);
  f.getDocument.mockImplementation(() => ({
    promise: Promise.reject(new Error("Invalid PDF structure.")),
    destroy: f.destroy,
  }));
  await expect(renderPdfFirstPage(pdf("broken.pdf"), f.deps)).resolves.toEqual({
    ok: false,
    problem: '"broken.pdf" could not be read as a PDF.',
  });
}

/**
 * The lazy chunk or the module did not load: the sentence says to reload, not that the file is bad.
 * Mutation: fold the `loadPdfjs` failure into the unreadable sentence → red.
 */
export async function asksForAReloadWhenTheModuleDoesNotLoad(): Promise<void> {
  const f = fake(1, () => 1000);
  f.deps.loadPdfjs = () => Promise.reject(new TypeError("Failed to fetch dynamically imported module"));
  await expect(renderPdfFirstPage(pdf("sld.pdf"), f.deps)).resolves.toEqual({
    ok: false,
    problem: '"sld.pdf" could not be prepared: reload the page and try again.',
  });
}

/** A PNG over the limit is rendered again smaller, and the first one that fits is kept. */
export async function rendersAgainSmallerUntilItFits(): Promise<void> {
  const f = fake(2, (side) => (side > 1536 ? MAX_COPILOT_ATTACHMENT_BYTES + 1 : MAX_COPILOT_ATTACHMENT_BYTES));
  const result = await renderPdfFirstPage(pdf("big.pdf"), f.deps);
  expect(result.ok).toBe(true);
  expect(f.sides).toEqual([2048, 1536]);
}

/**
 * The downscale loop stops at 1024 px and refuses (decision 3).
 * Mutations: `PDF_PAGE_MIN_SIDE = 512` → red (the sides go on); drop the clamp to 1024 → red (864 is rendered).
 */
export async function stopsTheDownscaleAt1024AndRefuses(): Promise<void> {
  const f = fake(1, () => MAX_COPILOT_ATTACHMENT_BYTES + 1);
  const result = await renderPdfFirstPage(pdf("huge.pdf"), f.deps);
  expect(f.sides).toEqual([2048, 1536, 1152, 1024]);
  expect(result).toEqual({ ok: false, problem: 'Page 1 of "huge.pdf" is larger than 10 MB as an image.' });
}

/**
 * An open that never settles is refused after `timeoutMs` (decision 3).
 * Mutation: await the work alone, with no race → red (the case outlives vitest's 5 s limit).
 */
export async function refusesAnOpenThatOutlivesTheTimeout(): Promise<void> {
  const f = fake(1, () => 1000);
  hangs(f);
  await expect(renderPdfFirstPage(pdf("slow.pdf"), f.deps)).resolves.toEqual({
    ok: false,
    problem: '"slow.pdf" could not be read as a PDF.',
  });
}

/* The loading task is destroyed once on every path. Mutation: drop the `finally` → all four red. */

export async function destroysTheTaskOnSuccess(): Promise<void> {
  const f = fake(1, () => 1000);
  const result = await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(result.ok).toBe(true);
  expect(f.destroy).toHaveBeenCalledTimes(1);
}

export async function destroysTheTaskOnAnOpenFailure(): Promise<void> {
  const f = fake(1, () => 1000);
  f.getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error("bad")), destroy: f.destroy }));
  const result = await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(result.ok).toBe(false);
  expect(f.destroy).toHaveBeenCalledTimes(1);
}

export async function destroysTheTaskOnTheTooLargeRefusal(): Promise<void> {
  const f = fake(1, () => MAX_COPILOT_ATTACHMENT_BYTES + 1);
  const result = await renderPdfFirstPage(pdf("huge.pdf"), f.deps);
  expect(result.ok).toBe(false);
  expect(f.destroy).toHaveBeenCalledTimes(1);
}

export async function destroysTheTaskOnATimeout(): Promise<void> {
  const f = fake(1, () => 1000);
  hangs(f);
  const result = await renderPdfFirstPage(pdf("slow.pdf"), f.deps);
  expect(result.ok).toBe(false);
  expect(f.destroy).toHaveBeenCalledTimes(1);
}

/** Two picks of one name are two renders: one ending leaves the other. Mutation: `filter` out every match → red. */
export function removesOneRenderNamePerEnd(): void {
  expect(withoutEach(["a.pdf", "a.pdf", "b.pdf"], ["a.pdf"])).toEqual(["a.pdf", "b.pdf"]);
}
