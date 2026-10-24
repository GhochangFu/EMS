import { describe, it } from "vitest";

import {
  noEntryIsOfferedToTheAssetGroupAdmin,
  theImageDeleteIsExcluded,
  theImagePathEncodesTheAssetId,
  theImportHashLeavesOutOnlyThePreview,
  theImportModelBodyRefusesOverwrite,
  theImportSummaryNamesTheFile,
  theImportSummarySaysConflictsAreRejected,
  thePreviewPostIsExcluded,
  theReadingsModelBodyRefusesOverwrite,
  theReadingsSummaryNamesTheRowCount,
  theThreeEntriesAreInTheCatalog,
  theTwoUploadsAreFileKind,
} from "./file-data.spec";

/** `F4.283` — Vitest entry point for the file-borne data entries. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — telemetry import, manual readings and asset image catalog entries (ADR 0099 Amendment 8)", () => {
  it("the three entries are in the catalog", () => theThreeEntriesAreInTheCatalog());
  it("no entry is offered to the asset-group admin", () => noEntryIsOfferedToTheAssetGroupAdmin());
  it("the import hash leaves out only preview", () => theImportHashLeavesOutOnlyThePreview());
  it("the import summary names the file", () => theImportSummaryNamesTheFile());
  it("the import summary says conflicting readings are rejected", () => theImportSummarySaysConflictsAreRejected());
  it("the readings summary names the row count", () => theReadingsSummaryNamesTheRowCount());
  it("the import model body refuses overwrite", () => theImportModelBodyRefusesOverwrite());
  it("the readings model body refuses overwrite", () => theReadingsModelBodyRefusesOverwrite());
  it("the import preview POST is excluded", () => thePreviewPostIsExcluded());
  it("the image DELETE is excluded", () => theImageDeleteIsExcluded());
  it("the image path encodes the asset id", () => theImagePathEncodesTheAssetId());
  it("the two uploads keep the bytes in the browser", () => theTwoUploadsAreFileKind());
});
