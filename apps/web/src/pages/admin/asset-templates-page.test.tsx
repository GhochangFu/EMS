// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aBlockedStoreRendersEveryGroupOpen,
  aCollapsedGroupHidesItsRowsWithoutUnmountingTheCard,
  anEntryWhoseDomainIsNotInTheVocabularyRendersUnderAFallbackHeading,
  cardIsAbsentForARoleThatCannotAuthor,
  collapseStateIsRememberedForTheNextVisit,
  eachStockRowLinksToTheReadOnlyViewer,
  emptyCatalogRendersTheEmptyState,
  failedImportRendersThroughApiErrorMessage,
  importsAStockEntryIntoTheChosenOrganization,
  stockEntriesAreGroupedByDomainInVocabularyOrder,
} from "./asset-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.13 asset templates list page — the stock catalog card", () => {
  /**
   * The order of these three is load-bearing (`F2.17`).
   * `aBlockedStoreRendersEveryGroupOpen` leaves a throwing `window
   * .localStorage` ACCESSOR in place until `vi.restoreAllMocks()` puts jsdom's
   * back — so the `clear()` that resets the collapse key between cases has to
   * come after it, not before. `cleanup()` leads because it only unmounts.
   */
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
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

  it("groups stock entries under one heading per domain, in vocabulary order", async () => {
    await stockEntriesAreGroupedByDomainInVocabularyOrder();
  });

  it("renders an entry whose domain the vocabulary lacks under a fallback heading", async () => {
    await anEntryWhoseDomainIsNotInTheVocabularyRendersUnderAFallbackHeading();
  });

  it("hides a collapsed group's rows without unmounting the card", async () => {
    await aCollapsedGroupHidesItsRowsWithoutUnmountingTheCard();
  });

  it("remembers the collapse state for the next visit", async () => {
    await collapseStateIsRememberedForTheNextVisit();
  });

  it("renders every group open when the storage accessor itself throws", async () => {
    await aBlockedStoreRendersEveryGroupOpen();
  });
});
