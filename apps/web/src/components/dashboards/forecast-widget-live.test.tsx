// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  theActualReadRepollsUntilA403,
  aForbiddenReadDrawsTheAccessSentence,
  resetLiveMocks,
  theTwoReadsNameTheBoundPoint,
} from "./forecast-widget-live.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetLiveMocks();
});
afterEach(() => {
  cleanup();
});

describe("E1.4c — the live forecast widget", () => {
  it("reads the bound point's 24 h hourly actuals and its forecast", async () => {
    await theTwoReadsNameTheBoundPoint();
  });

  it("draws the access sentence on a 403", async () => {
    await aForbiddenReadDrawsTheAccessSentence();
  });
  it("re-polls the actual read every 15 minutes and stops after a 403", () => theActualReadRepollsUntilA403());
});
