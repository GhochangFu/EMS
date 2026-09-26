// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  allPointsExpandsTheCard,
  cardShowsFourRows,
  cleanupView,
  domainHeadingsInDtoOrder,
  domainPanelsCountTheirAssets,
  fewerPointsCollapsesTheCard,
  fullScopeHidesTheLine,
  generatedReadRefetchesEvery30s,
  kpiReadErrorLine,
  kpiTilesReadTheLocationDashboard,
  liveRowShowsValueUndimmed,
  liveTurnsStaleOnTheTick,
  noDomainsSaysSo,
  noSampleReadsNone,
  nullLatestPrintsTheDash,
  oneSocketWithTheToken,
  partialScopeShowsTheLine,
  pendingReadSaysLoading,
  staleRowShowsValueDimmed,
  trackedReadingChangesItsRow,
  unknownAssetReadingChangesNothing,
  unmountDisconnects,
  unregisteredKeyChangesNothing,
  viewReadErrorLine,
} from "./generated-site-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.68 GeneratedSiteView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupView();
  });

  it("W1a renders one domain heading per domain, in DTO order", async () => {
    await domainHeadingsInDtoOrder();
  });

  it("W1b states each domain's asset count", async () => {
    await domainPanelsCountTheirAssets();
  });

  it("W2a shows the first four point rows", async () => {
    await cardShowsFourRows();
  });

  it('W2b expands to every row on "All points"', async () => {
    await allPointsExpandsTheCard();
  });

  it('W2c collapses to four rows on "Fewer points"', async () => {
    await fewerPointsCollapsesTheCard();
  });

  it("W3 reads the six KPI tiles from the location dashboard", async () => {
    await kpiTilesReadTheLocationDashboard();
  });

  it("W4a shows the partial-scope line for a partial scope", async () => {
    await partialScopeShowsTheLine();
  });

  it("W4b hides the partial-scope line for a full scope", async () => {
    await fullScopeHidesTheLine();
  });

  it("W5a changes a row on a tracked socket reading", async () => {
    await trackedReadingChangesItsRow();
  });

  it("W5b changes nothing on a reading for an unknown asset", async () => {
    await unknownAssetReadingChangesNothing();
  });

  it("W5c changes nothing on an unregistered key of a held asset", async () => {
    await unregisteredKeyChangesNothing();
  });

  it("W6 turns Live to Stale on the staleness tick with no socket traffic", async () => {
    await liveTurnsStaleOnTheTick();
  });

  it("W7a prints the dash for a point with no sample", async () => {
    await nullLatestPrintsTheDash();
  });

  it("W7b reads None for an asset with no sample", async () => {
    await noSampleReadsNone();
  });

  it("W8a prints the site view read's error line", async () => {
    await viewReadErrorLine();
  });

  it("W8b prints the KPI read's error line", async () => {
    await kpiReadErrorLine();
  });

  it("W9a opens one socket on /ws/telemetry with the session token", async () => {
    await oneSocketWithTheToken();
  });

  it("W9b disconnects the socket on unmount", async () => {
    await unmountDisconnects();
  });

  it("says so when no asset is in scope", async () => {
    await noDomainsSaysSo();
  });

  it("says loading, not empty, while the read is pending", async () => {
    await pendingReadSaysLoading();
  });

  it("W10a shows a stale row's value, dimmed", async () => {
    await staleRowShowsValueDimmed();
  });

  it("W10b shows a live row's value with no dimmed class", async () => {
    await liveRowShowsValueUndimmed();
  });

  it("W11 refetches the generated site view every 30 s", async () => {
    await generatedReadRefetchesEvery30s();
  });
});
