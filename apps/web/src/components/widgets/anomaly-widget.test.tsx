// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aForbiddenReadSaysTheAccessSentence,
  noPointBoundSaysSo,
  noScoresYetSaysSo,
  resetRecorded,
  scoresDrawTheLineTheThresholdAndTheMarks,
  theStaticDrawReadsNothing,
  theTooltipAndTheAxisShareTheZoneAndTheCaptionNamesIt,
} from "./anomaly-widget.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetRecorded();
});
afterEach(() => {
  cleanup();
});

describe("E1.2d — the anomaly widget", () => {
  it("says no point is bound", () => {
    noPointBoundSaysSo();
  });

  it("says the asset has no anomaly scores yet", () => {
    noScoresYetSaysSo();
  });

  it("says the access sentence on a 403", () => {
    aForbiddenReadSaysTheAccessSentence();
  });

  it("draws the score line, the 0.99 line, the unusual-hour marks and the advisory caption", () => {
    scoresDrawTheLineTheThresholdAndTheMarks();
  });

  it("formats the tooltip header in the axis's zone under a non-UTC TZ, and names the zone", () => {
    theTooltipAndTheAxisShareTheZoneAndTheCaptionNamesIt();
  });

  it("draws a static sentence when nothing is read", () => {
    theStaticDrawReadsNothing();
  });
});
