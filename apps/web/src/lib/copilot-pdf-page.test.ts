import { describe, it } from "vitest";

import {
  opensTheDocumentWithEvalOff,
  refusesAPdfThatCannotBeOpened,
  rendersAgainSmallerUntilItFits,
  rendersPageOneToANamedPng,
  rendersTheLongerSideAt2048,
  stopsTheDownscaleAt1024AndRefuses,
} from "./copilot-pdf-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * No `@vitest-environment` docblock: the project's `node` default.
 */
describe("F4.269 — a PDF's first page as a PNG (ADR 0105)", () => {
  it("renders page 1 to a PNG named -page-1.png with the page count", rendersPageOneToANamedPng);
  it("renders the longer side at 2048 px", rendersTheLongerSideAt2048);
  it("opens the document with isEvalSupported: false", opensTheDocumentWithEvalOff);
  it("refuses a PDF that cannot be opened with one sentence", refusesAPdfThatCannotBeOpened);
  it("renders again smaller until the PNG fits", rendersAgainSmallerUntilItFits);
  it("stops the downscale at 1024 px and refuses", stopsTheDownscaleAt1024AndRefuses);
});
