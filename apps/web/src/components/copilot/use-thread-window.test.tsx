// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  anAppendedRowShowsOnce,
  aRefusedPageSaysSo,
  aThreadInvalidationKeepsTheEarlierRows,
  aTruncatedThreadKeepsTheEarlierRows,
  hasEarlierFollowsThePage,
  hasEarlierIsTheThreadsAtFirst,
  loadEarlierReadsBeforeTheOldestRow,
  prependedCountsTheNewRows,
  theAnswerGoesInFrontInOrder,
  theWindowIsTheThreadAtFirst,
} from "./use-thread-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
describe("F4.292 useThreadWindow — earlier pages beside the thread", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the window is the thread at first", theWindowIsTheThreadAtFirst);
  it("hasEarlier is the thread's at first", hasEarlierIsTheThreadsAtFirst);
  it("Load earlier reads before the oldest row, 50 at a time", loadEarlierReadsBeforeTheOldestRow);
  it("the answer goes in front, in order", theAnswerGoesInFrontInOrder);
  it("hasEarlier follows the page", hasEarlierFollowsThePage);
  it("prepended counts the new rows", prependedCountsTheNewRows);
  it("a truncated thread keeps the earlier rows", aTruncatedThreadKeepsTheEarlierRows);
  it("an appended row shows once", anAppendedRowShowsOnce);
  it("a thread invalidation keeps the earlier rows (critic)", aThreadInvalidationKeepsTheEarlierRows);
  it("a refused page says so", aRefusedPageSaysSo);
});
