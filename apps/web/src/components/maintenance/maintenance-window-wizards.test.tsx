// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aValidCreatePostsTheExactBody,
  anEightDayWindowCannotLeaveTheWindowStep,
  cancelPostsToTheCancelRoute,
  extendKeepsTheSevenDayRuleFromNow,
  theReviewShowsTheEntrysSummary,
} from "./maintenance-window-wizards.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 U15 — the maintenance-window wizards (ADR 0131 decisions 2 and 16)", () => {
  it("W1 an end 8 days out cannot leave the Window step and names the 7-day rule", anEightDayWindowCannotLeaveTheWindowStep);
  it("W2 a valid create posts the exact body, with no startsAt for Now", aValidCreatePostsTheExactBody);
  it("W3 the Review step shows the entry's summary", theReviewShowsTheEntrysSummary);
  it("W4 Extend keeps the 7-day rule from now and sends only the new end", extendKeepsTheSevenDayRuleFromNow);
  it("W5 Cancel posts to the cancel route", cancelPostsToTheCancelRoute);
});
