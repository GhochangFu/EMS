// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aNullTitleShowsTheFallback,
  anotherRowIsNotCurrent,
  aRowClickOpensThatRow,
  newChatCallsOnNew,
  rowsKeepTheGivenOrder,
  theOpenRowIsCurrent,
  theSearchIgnoresCase,
  theSearchIsASubstringOfTheTitle,
} from "./conversation-list.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.292 ConversationList — the rows and the search", () => {
  it("rows keep the given order", rowsKeepTheGivenOrder);
  it("the search is a substring of the title", theSearchIsASubstringOfTheTitle);
  it("the search ignores case", theSearchIgnoresCase);
  it("a null title shows the fallback", aNullTitleShowsTheFallback);
});

describe("F4.292 ConversationList — opening and starting a chat", () => {
  it("New chat calls onNew", newChatCallsOnNew);
  it("a row click opens that row", aRowClickOpensThatRow);
  it("the open row is current", theOpenRowIsCurrent);
  it("another row is not current", anotherRowIsNotCurrent);
});
