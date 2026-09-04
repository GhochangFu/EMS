// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aBlockedStoreRendersEveryGroupOpen,
  aCollapsedGroupHidesItsRowsWithoutUnmountingTheCard,
  aPickerWithASingleValueIsNotRendered,
  anEntryWhoseDomainIsNotInTheVocabularyRendersUnderAFallbackHeading,
  cardIsAbsentForARoleThatCannotAuthor,
  collapseStateIsRememberedForTheNextVisit,
  eachStockRowLinksToTheReadOnlyViewer,
  eachTabShowsHowManyRowsItHolds,
  emptyCatalogRendersTheEmptyState,
  failedImportRendersThroughApiErrorMessage,
  importsAStockEntryIntoTheChosenOrganization,
  organizationAndDomainFiltersNarrowTheList,
  pickersOfferOnlyWhatIsPresentInVocabularyOrder,
  stockEntriesAreGroupedByDomainInVocabularyOrder,
  switchingTabsSwapsTheListAndRecordsItInTheUrl,
} from "./asset-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F2.13 asset templates list page — the stock catalog card", () => {
  /**
   * The order of these three is load-bearing (`F2.17`), and what it protects is
   * this `afterEach` itself rather than the next case.
   *
   * `aBlockedStoreRendersEveryGroupOpen` leaves a throwing `window.localStorage`
   * ACCESSOR in place until `vi.restoreAllMocks()` puts jsdom's back. Run
   * `clear()` before that restore and the teardown throws on the accessor, so
   * every later case fails on a teardown error rather than on its own
   * assertion. `cleanup()` leads because it only unmounts.
   *
   * It is NOT what stops the throwing accessor reaching another case — that
   * case is the last `it` in this file, so nothing follows it whatever the
   * order. The reason to keep this order is the teardown, and the reason to
   * keep the case last is defence in depth for the day someone appends one.
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

  /** `F2.21` — the two lists as peer tabs, and the Templates list's filters. */
  it("swaps the rendered list when a tab is selected, and back again", async () => {
    await switchingTabsSwapsTheListAndRecordsItInTheUrl();
  });

  it("shows each tab's row count without opening it", async () => {
    await eachTabShowsHowManyRowsItHolds();
  });

  it("narrows the list by organization and by domain, and says how many of how many", async () => {
    await organizationAndDomainFiltersNarrowTheList();
  });

  it("offers only the organizations and domains present, in the vocabulary's order", async () => {
    await pickersOfferOnlyWhatIsPresentInVocabularyOrder();
  });

  it("does not render a picker that could only offer one value", async () => {
    await aPickerWithASingleValueIsNotRendered();
  });
});
