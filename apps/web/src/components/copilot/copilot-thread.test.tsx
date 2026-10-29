// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aClickOpensTheFullText,
  aClosedActionRowHasNoBody,
  aLoadingPageIsBusy,
  anActionRowIsAClosedDetails,
  aPrependKeepsTheScrollPlace,
  aRefusedPageSaysSo,
  aScrollUpShowsJumpToLatest,
  atTheBottomANewRowIsFollowed,
  atTheBottomThereIsNoJump,
  jumpToLatestHidesItself,
  jumpToLatestScrollsToTheBottom,
  loadEarlierCallsTheLoader,
  noLoadEarlierWithoutEarlierRows,
  oneSeparatorPerLocalDay,
  scrolledUpANewRowMovesNothing,
  theSummaryHoldsTheFirstLineOnly,
} from "./copilot-thread.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.292 CopilotThread — the rows", () => {
  it("one separator per local day", oneSeparatorPerLocalDay);
  it("an action row is a closed details", anActionRowIsAClosedDetails);
  it("the summary holds the first line only", theSummaryHoldsTheFirstLineOnly);
  it("a closed action row has no body (critic)", aClosedActionRowHasNoBody);
  it("a click opens the full text (critic)", aClickOpensTheFullText);
});

describe("F4.292 CopilotThread — Load earlier", () => {
  it("no Load earlier without earlier rows", noLoadEarlierWithoutEarlierRows);
  it("Load earlier calls the loader", loadEarlierCallsTheLoader);
  it("a loading page is busy", aLoadingPageIsBusy);
  it("a refused page says so", aRefusedPageSaysSo);
  it("a prepend keeps the scroll place", aPrependKeepsTheScrollPlace);
});

describe("F4.292 CopilotThread — following and Jump to latest", () => {
  it("at the bottom, a new row is followed", atTheBottomANewRowIsFollowed);
  it("scrolled up, a new row moves nothing", scrolledUpANewRowMovesNothing);
  it("a scroll up shows Jump to latest", aScrollUpShowsJumpToLatest);
  it("Jump to latest scrolls to the bottom", jumpToLatestScrollsToTheBottom);
  it("Jump to latest hides itself", jumpToLatestHidesItself);
  it("at the bottom there is no Jump", atTheBottomThereIsNoJump);
});
