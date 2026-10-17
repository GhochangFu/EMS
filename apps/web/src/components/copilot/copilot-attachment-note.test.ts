import { describe, it } from "vitest";

import { anImageOrNoFileIsNotAPdf, anUpperCasePdfIsAPdf, aPdfBesideAnImageIsAPdf } from "./copilot-attachment-note.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.268 — which chosen files show the PDF note (ADR 0090 Amendment 3 ruling 6)", () => {
  it("an upper-case .PDF is a PDF", () => anUpperCasePdfIsAPdf());
  it("a PDF beside an image is a PDF", () => aPdfBesideAnImageIsAPdf());
  it("an image or no file is not a PDF", () => anImageOrNoFileIsNotAPdf());
});
