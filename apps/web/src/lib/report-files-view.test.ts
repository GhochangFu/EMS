import { describe, it } from "vitest";

import {
  aNonNoneStatusIgnoresAScheduleId,
  everyDeliveryStatusHasItsExactLabel,
  formatBytesAtTheFourBoundaries,
  formatLabelsAreExact,
  noneWithAScheduleIdIsPending,
  noneWithNoScheduleIdIsOnDemand,
  originLabelNamesBothOrigins,
  periodLabelJoinsWithAnEnDash,
  previewErrorOutranksTheMissingOrganization,
  saveBlockedReasonIsNullWhenNothingBlocks,
  saveBlockedReasonPerCondition,
} from "./report-files-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 */
describe("F3.5a report-files-view", () => {
  it("labels every delivery status with R-14's exact sentence", () => {
    everyDeliveryStatusHasItsExactLabel();
  });

  it("labels 'none' with a scheduleId as Pending", () => {
    noneWithAScheduleIdIsPending();
  });

  it("labels 'none' with no scheduleId as On demand", () => {
    noneWithNoScheduleIdIsOnDemand();
  });

  it("ignores a scheduleId for a non-none status", () => {
    aNonNoneStatusIgnoresAScheduleId();
  });

  it("names both origins", () => {
    originLabelNamesBothOrigins();
  });

  it("labels the two report formats exactly", () => {
    formatLabelsAreExact();
  });

  it("formats byte sizes at the four measured boundaries", () => {
    formatBytesAtTheFourBoundaries();
  });

  it("joins the period with an en dash", () => {
    periodLabelJoinsWithAnEnDash();
  });

  it("blocks the save for each condition with its own sentence", () => {
    saveBlockedReasonPerCondition();
  });

  it("is not blocked when nothing holds", () => {
    saveBlockedReasonIsNullWhenNothingBlocks();
  });

  it("prefers the preview-error sentence when two conditions hold at once", () => {
    previewErrorOutranksTheMissingOrganization();
  });
});
