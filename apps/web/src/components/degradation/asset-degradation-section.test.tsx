// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aBeyondHorizonIndicatorDrawsItsSentence,
  aFailedReadDrawsNothing,
  aPendingReadDrawsNothing,
  everyStringIsDrawnAsSent,
  noIndicatorDrawsNothing,
  theAssumptionsAreClosed,
  thePillIsInfoAndNoSeverityColourAppears,
} from "./asset-degradation-section.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.5b — the asset history degradation section", () => {
  it("draws every server string as sent, then the first schedule note", () => everyStringIsDrawnAsSent());
  it("the pill is the info tone and no severity colour appears", () => thePillIsInfoAndNoSeverityColourAppears());
  it("the assumptions sit in a closed <details>", () => theAssumptionsAreClosed());
  it("a beyond_horizon indicator draws its sentence", () => aBeyondHorizonIndicatorDrawsItsSentence());
  it("no indicator draws nothing", () => noIndicatorDrawsNothing());
  it("a pending read draws nothing", () => aPendingReadDrawsNothing());
  it("a failed read draws nothing, once its retries are spent", () => aFailedReadDrawsNothing(), 10_000);
});
