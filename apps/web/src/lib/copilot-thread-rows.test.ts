import { describe, it } from "vitest";

import {
  aNaNScrollPlaceIsZero,
  anActionRowIsCollapsed,
  anAssistantRowIsNotCollapsed,
  anEarlierPageGoesInFront,
  anEmptyNewestKeepsTheKnownRows,
  aNewestPageWithNoOverlapReplacesTheWindow,
  anOlderDayIsItsMediumDate,
  appendedRowsShowOnce,
  aTruncatedNewestKeepsTheEarlierRows,
  beyondTheSlackIsNotAtTheBottom,
  keepsTheScrollPlaceAfterAPrepend,
  nowsDayIsToday,
  rowsThatShareOneTimeKeepTheServerOrder,
  theDayBeforeIsYesterday,
  theFirstRowIsAlwaysASeparator,
  theSummaryIsTheFirstLine,
  twoMessagesAcrossLocalMidnightGetTwoSeparators,
  twoMessagesOnOneLocalDayGetOneSeparator,
  withinTheSlackIsAtTheBottom,
} from "./copilot-thread-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
describe("F4.292 copilot thread rows — the day separators", () => {
  it("two messages on one local day get one separator", twoMessagesOnOneLocalDayGetOneSeparator);
  it("two messages across local midnight get two separators", twoMessagesAcrossLocalMidnightGetTwoSeparators);
  it("the first row is always a separator", theFirstRowIsAlwaysASeparator);
  it("now's day is Today", nowsDayIsToday);
  it("the day before is Yesterday", theDayBeforeIsYesterday);
  it("an older day is its medium date", anOlderDayIsItsMediumDate);
});

describe("F4.292 copilot thread rows — the collapsed action rows", () => {
  it("an action row is collapsed", anActionRowIsCollapsed);
  it("an assistant row is not collapsed", anAssistantRowIsNotCollapsed);
  it("the summary is the first line", theSummaryIsTheFirstLine);
});

describe("F4.292 copilot thread rows — the window of loaded rows", () => {
  it("rows that share one time keep the server order (critic)", rowsThatShareOneTimeKeepTheServerOrder);
  it("a truncated newest page keeps the earlier rows", aTruncatedNewestKeepsTheEarlierRows);
  it("appended rows show once", appendedRowsShowOnce);
  it("a newest page with no overlap replaces the window (critic)", aNewestPageWithNoOverlapReplacesTheWindow);
  it("an empty newest keeps the known rows", anEmptyNewestKeepsTheKnownRows);
  it("an earlier page goes in front", anEarlierPageGoesInFront);
});

describe("F4.292 copilot thread rows — the scroll", () => {
  it("keeps the scroll place after a prepend", keepsTheScrollPlaceAfterAPrepend);
  it("a NaN scroll place is 0", aNaNScrollPlaceIsZero);
  it("within the slack is at the bottom", withinTheSlackIsAtTheBottom);
  it("beyond the slack is not at the bottom", beyondTheSlackIsNotAtTheBottom);
});
