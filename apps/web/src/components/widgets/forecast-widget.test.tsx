// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aForbiddenReadSaysTheAccessSentence,
  aForecastDrawsTheBandAndTheAdvisoryCaption,
  noForecastYetStillDrawsTheActualLine,
  noPointBoundSaysSo,
  resetRecorded,
  theStaticDrawReadsNothing,
} from "./forecast-widget.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetRecorded();
});
afterEach(() => {
  cleanup();
});

describe("E1.4c — the forecast widget", () => {
  it("says no point is bound", () => {
    noPointBoundSaysSo();
  });

  it("draws the actual line and says there is no forecast yet", () => {
    noForecastYetStillDrawsTheActualLine();
  });

  it("says the access sentence on a 403", () => {
    aForbiddenReadSaysTheAccessSentence();
  });

  it("draws the band and p50 with the advisory caption", () => {
    aForecastDrawsTheBandAndTheAdvisoryCaption();
  });

  it("draws a static sentence when nothing is read", () => {
    theStaticDrawReadsNothing();
  });
});
