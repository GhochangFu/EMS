import { expect } from "vitest";

import { hasPdfFile } from "./copilot-attachment-note";

/**
 * `F4.268` (ADR 0090 Amendment 3 ruling 6) — which chosen files show the
 * composer's PDF note. Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

function named(...names: string[]): File[] {
  return names.map((name) => new File([new Uint8Array([1])], name));
}

/** An upper-case `.PDF` is a PDF, as `attachmentProblem` reads it. Mutation: drop `toLowerCase()` → red. */
export function anUpperCasePdfIsAPdf(): void {
  expect(hasPdfFile(named("sld.PDF"))).toBe(true);
}

/** A PDF beside an image still shows the note. Mutation: `some` → `every` → red. */
export function aPdfBesideAnImageIsAPdf(): void {
  expect(hasPdfFile(named("a.png", "b.pdf"))).toBe(true);
}

/** An image alone, or no file, is not. Mutation: `hasPdfFile = files.length > 0` → red. */
export function anImageOrNoFileIsNotAPdf(): void {
  expect(hasPdfFile(named("plant.png"))).toBe(false);
  expect(hasPdfFile([])).toBe(false);
}
