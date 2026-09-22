import { describe, it } from "vitest";

import {
  defaultTimezoneDoesNotFallThroughToTheSecondSelection,
  defaultTimezoneFallsBackWhenNothingIsSelected,
  defaultTimezoneReadsTheFirstSelectedLocationsZone,
  emailChannelOptionsExcludesANullOrganization,
  emailChannelOptionsExcludesWebhook,
  emailChannelOptionsIncludesTheMatch,
  everyCadenceHasItsExactLabel,
  nextRunLabelUsesToLocaleString,
  scheduleBlockedReasonAllowsAnEmptySelectionWhenWholeOrganizationIsOffered,
  scheduleBlockedReasonIsNullWhenNothingBlocks,
  scheduleBlockedReasonPerCondition,
} from "./report-schedules-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 */
describe("F3.5b report-schedules-view", () => {
  it("labels every cadence exactly", () => {
    everyCadenceHasItsExactLabel();
  });

  it("defaults the timezone to the first selected location's zone", () => {
    defaultTimezoneReadsTheFirstSelectedLocationsZone();
  });

  it("does not fall through to the second selection when the first has no zone", () => {
    defaultTimezoneDoesNotFallThroughToTheSecondSelection();
  });

  it("falls back to Asia/Kolkata when nothing is selected", () => {
    defaultTimezoneFallsBackWhenNothingIsSelected();
  });

  it("renders the next run instant through toLocaleString", () => {
    nextRunLabelUsesToLocaleString();
  });

  it("excludes a webhook channel from the email options", () => {
    emailChannelOptionsExcludesWebhook();
  });

  it("excludes a fleet-wide (null organization) channel from the email options", () => {
    emailChannelOptionsExcludesANullOrganization();
  });

  it("includes an email channel of the matching organization", () => {
    emailChannelOptionsIncludesTheMatch();
  });

  it("blocks the schedule form for each condition with its own sentence", () => {
    scheduleBlockedReasonPerCondition();
  });

  it("is not blocked when nothing holds", () => {
    scheduleBlockedReasonIsNullWhenNothingBlocks();
  });

  it("allows an empty location selection only when whole-organization is offered (step-5 nit)", () => {
    scheduleBlockedReasonAllowsAnEmptySelectionWhenWholeOrganizationIsOffered();
  });
});
