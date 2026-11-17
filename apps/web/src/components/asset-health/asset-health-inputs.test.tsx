// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  noAlarmColourInTheNewBlock,
  noAnomalyHistoryShowsNoAdvisoryLineAndNoZero,
  noMaintenanceShowsNoCount,
  theAdvisoryLineFollowsTheScoreAndNeverReplacesIt,
  theCaptionShowsOnlyWithTheAdvisoryLine,
  thePillIsTheInfoPill,
  withInputsTheFiveLabelsShowInOrder,
  withoutInputsTheCardIsAsToday,
} from "./asset-health-inputs.spec";

/**
 * `E1.8b` T2.4 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014), and the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2).
 */
describe("E1.8b the five inputs and the advisory line on the asset health card", () => {
  afterEach(() => {
    cleanup();
  });

  it("draws no inputs block, advisory line or caption without inputs", () => {
    withoutInputsTheCardIsAsToday();
  });

  it("shows the five input labels in SOW order with their words", () => {
    withInputsTheFiveLabelsShowInOrder();
  });

  it("puts the advisory line after the score and never in its place", () => {
    theAdvisoryLineFollowsTheScoreAndNeverReplacesIt();
  });

  it("marks the advisory line with the info pill", () => {
    thePillIsTheInfoPill();
  });

  it("carries no band, alarm or severity colour in the new block", () => {
    noAlarmColourInTheNewBlock();
  });

  it("shows no advisory line and no zero without anomaly history", () => {
    noAnomalyHistoryShowsNoAdvisoryLineAndNoZero();
  });

  it("shows no work-order count without a maintenance fact", () => {
    noMaintenanceShowsNoCount();
  });

  it("shows the caption only with the advisory line", () => {
    theCaptionShowsOnlyWithTheAdvisoryLine();
  });
});
