// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aCopyShowsResetAndTheBuilderLink,
  aFailedReadDrawsOneLine,
  aRefusedMakeShowsTheApisSentence,
  aViewerSeesNoActions,
  cleanupStrip,
  makeSendsThePutAndRereads,
  theStripDrawsFourteenTilesInOrder,
  tileTwoReadsLiveOverTotal,
} from "./organization-kpi-strip.spec";

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
});
