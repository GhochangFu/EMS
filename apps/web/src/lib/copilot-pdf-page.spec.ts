import { expect, vi } from "vitest";

import { MAX_COPILOT_ATTACHMENT_BYTES } from "@bms/shared/contracts";

import { renderedPageCount, renderPdfFirstPage, type PdfjsLike, type PdfPageDeps } from "./copilot-pdf-page";

/**
 * `F4.269` (ADR 0105 decisions 1, 3, 4, 5) — page 1 of a picked PDF becomes a
 * PNG. `pdfjs-dist` and the canvas are stubbed at the `deps` seam; `node`
 * environment (`File` and `Blob` are globals since Node 20).
 */

/** A US Letter page at scale 1: the longer side is the height. */
const LETTER = { width: 612, height: 792 };

type Fake = { deps: PdfPageDeps; getDocument: ReturnType<typeof vi.fn>; sides: number[] };

/**
 * A fake `pdfjs-dist` of `numPages` pages and a fake canvas whose PNG is
 * `pngBytes(longerSide)` bytes long, so a case decides which render fits.
 */
function fake(numPages: number, pngBytes: (side: number) => number): Fake {
  const sides: number[] = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: LETTER.width * scale, height: LETTER.height * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages, getPage: async () => page }),
    destroy: async () => undefined,
  }));
  const createCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({}),
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
  return { deps: { loadPdfjs: async () => ({ getDocument }) as unknown as PdfjsLike, createCanvas }, getDocument, sides };
}

const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

/** Mutation: name the PNG after the PDF unchanged (`sld.PDF`) or type it `application/pdf` → red. */
export async function rendersPageOneToANamedPng(): Promise<void> {
  const f = fake(3, () => 1000);
  const result = await renderPdfFirstPage(pdf("sld.PDF"), f.deps);
  if (!result.ok) throw new Error(result.problem);
  expect(result.png.name).toBe("sld-page-1.png");
  expect(result.png.type).toBe("image/png");
  expect(result.pageCount).toBe(3);
  expect(renderedPageCount(result.png)).toBe(3);
}

/** The first render's longer side is 2048 px. Mutation: `PDF_PAGE_MAX_SIDE = 4096` → red. */
export async function rendersTheLongerSideAt2048(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.sides).toEqual([2048]);
}

/** CVE-2024-4367 (decision 5). Mutation: drop `isEvalSupported: false` from the call → red. */
export async function opensTheDocumentWithEvalOff(): Promise<void> {
  const f = fake(1, () => 1000);
  await renderPdfFirstPage(pdf("a.pdf"), f.deps);
  expect(f.getDocument).toHaveBeenCalledTimes(1);
  expect(f.getDocument.mock.calls[0]?.[0]).toMatchObject({ isEvalSupported: false });
}

/**
 * A PDF `pdfjs-dist` cannot open is refused with the one sentence (decision 4).
 * Mutation: let the rejection escape the `try` → red.
 */
export async function refusesAPdfThatCannotBeOpened(): Promise<void> {
  const f = fake(1, () => 1000);
  f.getDocument.mockImplementation(() => ({
    promise: Promise.reject(new Error("Invalid PDF structure.")),
    destroy: async () => undefined,
  }));
  await expect(renderPdfFirstPage(pdf("broken.pdf"), f.deps)).resolves.toEqual({
    ok: false,
    problem: '"broken.pdf" could not be read as a PDF.',
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
