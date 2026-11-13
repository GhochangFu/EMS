// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFilledIdOutsideTheListsIsNamedAsSuch,
  aStartInThePastIsRefused,
  aTimedCreatePostsItsStart,
  aValidCreatePostsTheExactBody,
  anEndBeforeTheStartStaysOnTheWindowStep,
  extendShowsTheCurrentEndInLocalTime,
  targetsOfTwoOrganizationsAreRefused,
  theFourWritesSendNoCopilotHeader,
  anEightDayWindowCannotLeaveTheWindowStep,
  cancelPostsToTheCancelRoute,
  extendKeepsTheSevenDayRuleFromNow,
  theReviewShowsTheEntrysSummary,
} from "./maintenance-window-wizards.spec";

beforeAll(() => {
  vi.stubEnv("TZ", "Asia/Kolkata");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetWizardStore();
});

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). `TZ` is pinned to
 * Asia/Kolkata (UTC+05:30), so a time read or shown in UTC rather than the browser's zone fails.
 */
describe("F4.359 U15 — the maintenance-window wizards (ADR 0131 decisions 2 and 16)", () => {
  it("W1 an end 8 days out cannot leave the Window step and names the 7-day rule", anEightDayWindowCannotLeaveTheWindowStep);
  it("W2 a valid create posts the exact body, with no startsAt for Now", aValidCreatePostsTheExactBody);
  it("W3 the Review step shows the entry's summary", theReviewShowsTheEntrysSummary);
  it("W4 Extend keeps the 7-day rule from now and sends only the new end", extendKeepsTheSevenDayRuleFromNow);
  it("W5 Cancel posts to the cancel route", cancelPostsToTheCancelRoute);
  it("W6 At a time posts its startsAt, read in the browser's zone", aTimedCreatePostsItsStart);
  it("W7 an end before the start stays on the Window step", anEndBeforeTheStartStaysOnTheWindowStep);
  it("W8 a start in the past is refused", aStartInThePastIsRefused);
  it("W9 Extend shows the current end in local time", extendShowsTheCurrentEndInLocalTime);
  it("W10 a filled id outside the caller's lists is named as such", aFilledIdOutsideTheListsIsNamedAsSuch);
  it("W11 targets of two organizations are refused on the Targets step", targetsOfTwoOrganizationsAreRefused);
  it("W12 the four writes send no X-Copilot-Change header", theFourWritesSendNoCopilotHeader);
});
