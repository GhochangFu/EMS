// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aMeasuredPueTileStillCarriesTheStaleRing,
  aMeasuredRatioRendersOnTheDashboard,
  aNullLoadPriorRendersTheFixedHint,
  aPueFallRendersInThePueTile,
  anUnconfiguredEstateShowsTheDashAndTheReason,
  anUnconfiguredPueTileCarriesNoStaleRing,
  aTenPercentLoadRiseRendersInTheTotalLoadTile,
  openAlarmsWearsTheAlertIcon,
  openAlarmsWithoutADeltaReadActiveNotYetCleared,
  pueWearsTheGaugeIcon,
  sitesOnlineWearsNoIcon,
  theCriticalCountRendersInTheNote,
  theUnacknowledgedRowsLiteralIsGone,
  totalLoadWearsTheBoltIcon,
} from "./dashboard-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F2.8 executive dashboard PUE tile", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a measured ratio to two decimals", async () => {
    await aMeasuredRatioRendersOnTheDashboard();
  });

  it("renders a dash and the not-configured reason when the API returns null", async () => {
    await anUnconfiguredEstateShowsTheDashAndTheReason();
  });

  it("draws no stale ring around an unconfigured PUE tile", async () => {
    await anUnconfiguredPueTileCarriesNoStaleRing();
  });

  it("still draws the stale ring when the ratio is measured", async () => {
    await aMeasuredPueTileStillCarriesTheStaleRing();
  });
});

describe("F3.28 executive ribbon deltas, alarm hint and icons", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a 10 % server load rise in the Total load tile", async () => {
    await aTenPercentLoadRiseRendersInTheTotalLoadTile();
  });

  it("renders the fixed Total load hint when the prior is null", async () => {
    await aNullLoadPriorRendersTheFixedHint();
  });

  it("reads 'Active — not yet cleared' on Open alarms with no delta", async () => {
    await openAlarmsWithoutADeltaReadActiveNotYetCleared();
  });

  it("no longer renders 'Unacknowledged rows'", async () => {
    await theUnacknowledgedRowsLiteralIsGone();
  });

  it("renders the critical count on the note line", async () => {
    await theCriticalCountRendersInTheNote();
  });

  it("renders a PUE delta in place of the PUE tile's own hint", async () => {
    await aPueFallRendersInThePueTile();
  });

  it("puts the bolt icon on Total load", async () => {
    await totalLoadWearsTheBoltIcon();
  });

  it("puts the alert icon on Open alarms", async () => {
    await openAlarmsWearsTheAlertIcon();
  });

  it("puts the gauge icon on PUE", async () => {
    await pueWearsTheGaugeIcon();
  });

  it("puts no icon on Sites online", async () => {
    await sitesOnlineWearsNoIcon();
  });
});
