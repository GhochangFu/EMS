// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aForbiddenReadDrawsTheAccessSentenceAndStops,
  noScoresDrawsTheEmptySentence,
  resetLiveMocks,
  theReadNamesTheAssetAndSevenDays,
} from "./anomaly-widget-live.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  resetLiveMocks();
});
afterEach(() => {
  cleanup();
});

describe("E1.2d — the live anomaly widget", () => {
  it("reads the bound point's asset for the last 7 days", async () => {
    await theReadNamesTheAssetAndSevenDays();
  });

  it("says the asset has no scores yet", async () => {
    await noScoresDrawsTheEmptySentence();
  });

  it("draws the access sentence on a 403 and stops re-polling", async () => {
    await aForbiddenReadDrawsTheAccessSentenceAndStops();
  });
});
