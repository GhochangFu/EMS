// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  cardIsAbsentForARoleThatCannotAuthor,
  eachStockRowLinksToTheReadOnlyViewer,
  emptyCatalogRendersTheEmptyState,
  failedImportRendersThroughApiErrorMessage,
  importsAStockEntryIntoTheChosenOrganization,
} from "./asset-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.13 asset templates list page — the stock catalog card", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("imports a stock entry into the chosen organization and lands on the draft", async () => {
    await importsAStockEntryIntoTheChosenOrganization();
  });

  it("renders the empty state for an empty catalog and enables no Import", async () => {
    await emptyCatalogRendersTheEmptyState();
  });

  it("renders a failed import through apiErrorMessage, never the raw body", async () => {
    await failedImportRendersThroughApiErrorMessage();
  });

  it("links each stock row to the read-only viewer, beside Import", async () => {
    await eachStockRowLinksToTheReadOnlyViewer();
  });

  it("does not render the card for a role that cannot author templates", async () => {
    await cardIsAbsentForARoleThatCannotAuthor();
  });
});
