// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  theStripDrawsTheDailyCostChart,
  aCopyShowsResetAndTheBuilderLink,
  aFailedReadDrawsOneLine,
  aRefusedMakeShowsTheApisSentence,
  aFailingRefetchAgesTheLastAnswer,
  aSkewedServerClockDoesNotStaleTheStrip,
  aViewerSeesNoActions,
  cleanupStrip,
  makeSendsThePutAndRereads,
  theStripDrawsFourteenTilesInOrder,
  tileTwoReadsLiveOverTotal,
} from "./organization-kpi-strip.spec";

// `F4.332` — the daily cost chart draws through ECharts, which jsdom cannot (no canvas).
vi.mock("echarts-for-react", () => ({ default: () => null }));

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.317 OrganizationKpiStrip", () => {
  afterEach(() => {
    cleanupStrip();
  });

  it("C1 draws fourteen tiles in decision 6's order", async () => {
    await theStripDrawsFourteenTilesInOrder();
  });

  it("C2 reads tile 2 as live / total", async () => {
    await tileTwoReadsLiveOverTotal();
  });

  it("C3 sends the PUT on Make and re-reads", async () => {
    await makeSendsThePutAndRereads();
  });

  it("C4 shows the API's sentence for a refused Make", async () => {
    await aRefusedMakeShowsTheApisSentence();
  });

  it("C5 shows a viewer no button and no link", async () => {
    await aViewerSeesNoActions();
  });

  it("C6 shows a copy Reset and the builder link, and Reset sends the DELETE", async () => {
    await aCopyShowsResetAndTheBuilderLink();
  });

  it("C7 draws one alert line for a failed read", async () => {
    await aFailedReadDrawsOneLine();
  });

  it("C8 ages the last answer while reads keep failing", async () => {
    await aFailingRefetchAgesTheLastAnswer();
  });

  it("C9 ignores a skewed server clock", async () => {
    await aSkewedServerClockDoesNotStaleTheStrip();
  });
  // `F4.332` — ADR 0112 Amendment 3.
  it("draws the daily energy cost chart and its total", () => theStripDrawsTheDailyCostChart());
});
