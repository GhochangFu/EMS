// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aMalformedChecksValueStillListsTheRules,
  aRowShowsItsActionTypeAndTarget,
  aRowShowsItsCategoryAndClearHold,
  aRowShowsItsNameCodeAndDescription,
  aTimeWindowRowShowsItsDaysAndTimes,
  noPasswordBoxIsShownForExcludedRows,
  theBatchCardIsRedAndCarriesTheLiveLine,
  theTableListsEveryRowWithItsCheckAndTicksAll,
  untickingARowSendsItsIndexAndKeepsEveryRule,
  untickingEveryRowDisablesConfirm,
} from "./confirm-card.rule-batch.spec";

/** `F4.289` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.289 — the batch rule card (ADR 0099 Amendment 9 E3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lists every row with its check and ticks all", () => theTableListsEveryRowWithItsCheckAndTicksAll());
  it("sends every rule and the unticked index on Confirm", () => untickingARowSendsItsIndexAndKeepsEveryRule());
  it("disables Confirm when every row is unticked", () => untickingEveryRowDisablesConfirm());
  it("lists the rules from their own fields when checks is malformed", () => aMalformedChecksValueStillListsTheRules());
  it("is red and carries the live line", () => theBatchCardIsRedAndCarriesTheLiveLine());
  it("shows no password box for excludedRows", () => noPasswordBoxIsShownForExcludedRows());
  it("shows each row's name, code and description", () => aRowShowsItsNameCodeAndDescription());
  it("shows each row's action type and target", () => aRowShowsItsActionTypeAndTarget());
  it("shows each row's category and clear hold", () => aRowShowsItsCategoryAndClearHold());
  it("shows a time_window row's days and times", () => aTimeWindowRowShowsItsDaysAndTimes());
});
