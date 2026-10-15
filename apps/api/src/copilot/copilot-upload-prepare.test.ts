import { describe, it } from "vitest";

import {
  aMissingSvgIsRefused,
  anAttachmentIsUsedOnlyWhenTheTurnCarriesIt,
  anOversizeSvgIsRefused,
  aRefusedSvgIsTheToolError,
  aValidSvgTextIsStoredWithItsHash,
} from "./copilot-upload-prepare.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 6a — the upload proposal (ADR 0099 Amendment 3 A3)", () => {
  it("stores a valid SVG text with its hash", () => aValidSvgTextIsStoredWithItsHash());
  it("answers a refused SVG with the parser's reason", () => aRefusedSvgIsTheToolError());
  it("refuses an SVG over the size limit", () => anOversizeSvgIsRefused());
  it("uses an attachment only when the turn carries it", () => anAttachmentIsUsedOnlyWhenTheTurnCarriesIt());
  it("refuses a body with no svg", () => aMissingSvgIsRefused());
});
