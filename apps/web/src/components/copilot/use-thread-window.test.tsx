// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedReadInAnotherChatIsNotThisOnes,
  anAppendedRowShowsOnce,
  aPageAfterASwitchGoesToItsOwnChat,
  aPendingReadInAnotherChatIsNotThisOnes,
  aRefusedPageSaysSo,
  aThreadInvalidationKeepsTheEarlierRows,
  aTruncatedThreadKeepsTheEarlierRows,
  hasEarlierFollowsThePage,
  hasEarlierIsTheThreadsAtFirst,
  loadEarlierReadsBeforeTheOldestRow,
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
  it("a truncated thread keeps the earlier rows", aTruncatedThreadKeepsTheEarlierRows);
  it("an appended row shows once", anAppendedRowShowsOnce);
  it("a thread invalidation keeps the earlier rows (critic)", aThreadInvalidationKeepsTheEarlierRows);
  it("a refused page says so", aRefusedPageSaysSo);
});

describe("F4.292 useThreadWindow — a read belongs to its own chat (review)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a failed read in another chat is not this one's", aFailedReadInAnotherChatIsNotThisOnes);
  it("a pending read in another chat is not this one's", aPendingReadInAnotherChatIsNotThisOnes);
  it("a page that answers after a switch goes to its own chat", aPageAfterASwitchGoesToItsOwnChat);
});
