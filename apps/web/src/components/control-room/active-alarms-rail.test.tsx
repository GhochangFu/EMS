// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  emptyIdsFetchNoActiveList,
  emptyIdsFetchNoSummary,
  fetchesTheActiveListForTheGivenIds,
  pillToneComesFromTheVocabulary,
  rendersEightRowsAndNoNinth,
  rendersTheEmptyStateForNoActiveAlarms,
  resolvingIdsSayLoadingNotNone,
  socketEventRefetchesTheActiveList,
  socketEventRefetchesTheSummary,
  summaryTabListsCountsMostUrgentFirst,
  summaryTabShowsTheTotal,
  viewAllLinksToTheAlarmsPage,
} from "./active-alarms-rail.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 active alarms rail", () => {
  beforeEach(() => {
    // `restoreAllMocks` does not clear a `vi.fn`'s call history in Vitest 4;
    // the call-count claims below need every `it()` to start from zero.
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders eight rows and no ninth", async () => {
    await rendersEightRowsAndNoNinth();
  });

  it("takes the pill tone from the severity vocabulary", async () => {
    await pillToneComesFromTheVocabulary();
  });

  it("lists the summary counts most urgent first", async () => {
    await summaryTabListsCountsMostUrgentFirst();
  });

  it("shows the summary total", async () => {
    await summaryTabShowsTheTotal();
  });

  it("fetches the active list for the given ids", async () => {
    await fetchesTheActiveListForTheGivenIds();
  });

  it("refetches the active list on a socket event", async () => {
    await socketEventRefetchesTheActiveList();
  });

  it("refetches the summary on a socket event", async () => {
    await socketEventRefetchesTheSummary();
  });

  it("fetches no active list without ids", async () => {
    await emptyIdsFetchNoActiveList();
  });

  it("fetches no summary without ids", async () => {
    await emptyIdsFetchNoSummary();
  });

  it("renders the empty state when no alarm is active", async () => {
    await rendersTheEmptyStateForNoActiveAlarms();
  });

  it("says loading, not none, while the page's assets resolve", async () => {
    await resolvingIdsSayLoadingNotNone();
  });

  it("links View All to /alarms", () => {
    viewAllLinksToTheAlarmsPage();
  });
});
