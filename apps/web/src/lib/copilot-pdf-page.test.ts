import { describe, it } from "vitest";

import {
  asksForAReloadWhenTheModuleDoesNotLoad,
  boundsADecodedImageAt4096Squared,
  destroysTheTaskOnAnOpenFailure,
  destroysTheTaskOnATimeout,
  destroysTheTaskOnSuccess,
  destroysTheTaskOnTheTooLargeRefusal,
  namesThePngAfterThePdf,
  opensTheDocumentWithEvalOff,
  readsTheAssetsFromThisOrigin,
  recordsThePageCountForTheChip,
  refusesAnOpenThatOutlivesTheTimeout,
  refusesAPdfThatCannotBeOpened,
  removesOneRenderNamePerEnd,
  rendersAgainSmallerUntilItFits,
  rendersTheLongerSideAt2048,
  returnsThePdfsPageCount,
  stopsTheDownscaleAt1024AndRefuses,
  typesThePngAsImagePng,
} from "./copilot-pdf-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * No `@vitest-environment` docblock: the project's `node` default.
 */
describe("F4.269 — a PDF's first page as a PNG (ADR 0105)", () => {
  it("names the PNG <name>-page-1.png", namesThePngAfterThePdf);
  it("types the PNG image/png", typesThePngAsImagePng);
  it("returns the PDF's page count", returnsThePdfsPageCount);
  it("records the page count for the chip", recordsThePageCountForTheChip);
  it("renders the longer side at 2048 px", rendersTheLongerSideAt2048);
  it("opens the document with isEvalSupported: false", opensTheDocumentWithEvalOff);
  it("bounds a decoded image at 4096 x 4096 pixels", boundsADecodedImageAt4096Squared);
  it("reads the wasm, fonts and CMaps from this origin", readsTheAssetsFromThisOrigin);
  it("refuses a PDF that cannot be opened with one sentence", refusesAPdfThatCannotBeOpened);
  it("asks for a reload when the module does not load", asksForAReloadWhenTheModuleDoesNotLoad);
  it("renders again smaller until the PNG fits", rendersAgainSmallerUntilItFits);
  it("stops the downscale at 1024 px and refuses", stopsTheDownscaleAt1024AndRefuses);
  it("refuses an open that outlives the timeout", refusesAnOpenThatOutlivesTheTimeout);
  it("destroys the loading task once on success", destroysTheTaskOnSuccess);
  it("destroys the loading task once on an open failure", destroysTheTaskOnAnOpenFailure);
  it("destroys the loading task once on the too-large refusal", destroysTheTaskOnTheTooLargeRefusal);
  it("destroys the loading task once on a timeout", destroysTheTaskOnATimeout);
  it("removes one render name per end", removesOneRenderNamePerEnd);
});
