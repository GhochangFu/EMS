import { describe, it } from "vitest";

import {
  aFilenameThatMulterChangesIsRefused,
  aMissingSvgIsRefused,
  aPreparedBodyRoundTripsThroughTheRouteStage,
  anAttachmentIsUsedOnlyWhenTheTurnCarriesIt,
  anOversizeSvgIsRefused,
  aRefusedSvgIsTheToolError,
  aValidSvgTextIsStoredWithItsHash,
  aCsvImportStoresItsNameAndHash,
  aMissingFileIsTheAttachSentence,
  aPdfForTheImportIsTheTypeSentence,
  aPngImageStoresItsCaptionNameAndHash,
  aPreparedImportRoundTripsThroughTheRouteStage,
  aPreparedImportStoresNoBytes,
} from "./copilot-upload-prepare.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 6a — the upload proposal (ADR 0099 Amendment 3 A3)", () => {
  it("stores a valid SVG text with its hash", () => aValidSvgTextIsStoredWithItsHash());
  it("answers a refused SVG with the parser's reason", () => aRefusedSvgIsTheToolError());
  it("refuses an SVG over the size limit", () => anOversizeSvgIsRefused());
  it("uses an attachment only when the turn carries it", () => anAttachmentIsUsedOnlyWhenTheTurnCarriesIt());
  it("refuses a body with no svg", () => aMissingSvgIsRefused());
  it("round-trips a prepared body through the route stage's hash", () => aPreparedBodyRoundTripsThroughTheRouteStage());
  it("refuses a filename multer would change", () => aFilenameThatMulterChangesIsRefused());
});

describe("F4.283 — a file upload keeps the bytes in the browser (ADR 0099 Amendment 8 Q19)", () => {
  it("a CSV import stores its options, reject, its name and hash", () => aCsvImportStoresItsNameAndHash());
  it("a prepared import stores no bytes", () => aPreparedImportStoresNoBytes());
  it("a missing file is the attach sentence", () => aMissingFileIsTheAttachSentence());
  it("a PDF for the import is the type sentence", () => aPdfForTheImportIsTheTypeSentence());
  it("a PNG image stores its caption, name and hash", () => aPngImageStoresItsCaptionNameAndHash());
  it("a prepared import round-trips through the route stage", () => aPreparedImportRoundTripsThroughTheRouteStage());
});
