// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  anEmptyConfigAsksForBothKinds,
  paragraphOffMakesNoParagraphRequest,
  paragraphOnAsksForTheParagraph,
  restoreMlReads,
  showAnomaliesAsksForAnomaliesOnly,
  showPicksTheKinds,
  stubMlReads,
  theFrameDrawsTheTitleAndTheFacts,
  theScopeIsTheDashboardsOwn,
} from "./ml-findings-widget-live.spec";

/** Vitest entry point (ADR 0014, ADR 0042 decision 2). */
beforeEach(() => {
  stubMlReads();
});
afterEach(() => {
  cleanup();
  restoreMlReads();
});

describe("E1.9f — the live ml_findings widget (ADR 0135 Amendment 8 decision 13)", () => {
  it("draws its title in the frame and the findings card beneath it", async () => {
    await theFrameDrawsTheTitleAndTheFacts();
  });

  it("asks for the forecast summary only when show is forecasts", async () => {
    await showPicksTheKinds();
  });

  it("asks for the anomaly summary only when show is anomalies", async () => {
    await showAnomaliesAsksForAnomaliesOnly();
  });

  it("asks for both kinds when the config is {}", async () => {
    await anEmptyConfigAsksForBothKinds();
  });

  it("makes no paragraph request when paragraph is false", async () => {
    await paragraphOffMakesNoParagraphRequest();
  });

  it("asks for the paragraph on the dashboard's scope when paragraph is true", async () => {
    await paragraphOnAsksForTheParagraph();
  });

  it("reads the dashboard's organization plus its one set location, asset group or asset", async () => {
    await theScopeIsTheDashboardsOwn();
  });
});
