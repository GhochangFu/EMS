import { afterEach, describe, it, vi } from "vitest";

import {
  deleteResolvesOnA204,
  deleteThrowsApiErrorCarryingA403,
  downloadCsvStillNamesTheCsvAnchor,
  downloadPdfHitsExportPdf,
  downloadReportFileNamesTheAnchorAfterTheDto,
  fetchReportFilesReturnsTheList,
  saveWithOrganizationAddsItByKey,
  saveWithoutOrganizationPostsExactlyThreeFields,
} from "./reports.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.5a reports web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts exactly startDate, endDate and format when no organization is given", async () => {
    await saveWithoutOrganizationPostsExactlyThreeFields();
  });

  it("adds organizationId by key when one is given", async () => {
    await saveWithOrganizationAddsItByKey();
  });

  it("downloads the PDF export and names the anchor accordingly", async () => {
    await downloadPdfHitsExportPdf();
  });

  it("still names the CSV anchor after the saveBlob extraction", async () => {
    await downloadCsvStillNamesTheCsvAnchor();
  });

  it("names the downloaded report file's anchor after its filename", async () => {
    await downloadReportFileNamesTheAnchorAfterTheDto();
  });

  it("resolves with undefined when the delete answers 204", async () => {
    await deleteResolvesOnA204();
  });

  it("throws an ApiError carrying 403 when the file is out of scope", async () => {
    await deleteThrowsApiErrorCarryingA403();
  });

  it("fetches the report file list", async () => {
    await fetchReportFilesReturnsTheList();
  });
});
