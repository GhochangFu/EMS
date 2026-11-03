import { afterEach, describe, it, vi } from "vitest";

import {
  aFourHundredThrowsAViewExportErrorWithTheStatus,
  aWholeSiteStripSendsNoGroupKey,
  theEnergyExportFetchesTheViewSearchAndSavesTheFile,
  theEnergyXlsxNamesTheXlsxPathAndFile,
  theErrorMessageNeverCarriesTheBody,
  theHistoryExportCustomSearch,
  theHistoryExportPresetSearch,
  theRequestCarriesTheBearerHeader,
  theSegmentExportPathAndSearch,
  theStripExportPathAndSearch,
} from "./view-exports.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). No
 * `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.303 view exports web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("V1: the Energy export fetches the view search and saves energy-view.csv", async () => {
    await theEnergyExportFetchesTheViewSearchAndSavesTheFile();
  });
  it("V1: the Energy XLSX names the xlsx path and file", async () => {
    await theEnergyXlsxNamesTheXlsxPathAndFile();
  });
  it("V1: the request carries the bearer header", async () => {
    await theRequestCarriesTheBearerHeader();
  });
  it("V2: the segment export path and search", async () => {
    await theSegmentExportPathAndSearch();
  });
  it("V2: the strip export path and search", async () => {
    await theStripExportPathAndSearch();
  });
  it("V2: a whole-site strip sends no group key", async () => {
    await aWholeSiteStripSendsNoGroupKey();
  });
  it("V2: the history export preset search", async () => {
    await theHistoryExportPresetSearch();
  });
  it("V2: the history export custom search", async () => {
    await theHistoryExportCustomSearch();
  });
  it("V3: a 400 throws a ViewExportError with status 400", async () => {
    await aFourHundredThrowsAViewExportErrorWithTheStatus();
  });
  it("V3: the error message never carries the response body", async () => {
    await theErrorMessageNeverCarriesTheBody();
  });
});
