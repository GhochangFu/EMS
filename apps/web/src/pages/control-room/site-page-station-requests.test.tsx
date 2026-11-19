// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupRequests,
  theStationAssetsReadsOnlyTheResolve,
  theStationMakesNoStationItselfRead,
  theStationReadsOnlyTheSubtreeReads,
} from "./site-page-station-requests.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.240 part b the station page's request tripwire (ADR 0140 decision 5)", () => {
  afterEach(() => {
    cleanupRequests();
  });

  it("T1 names the station only in the subtree reads, the resolve and the dashboards list", async () => {
    await theStationReadsOnlyTheSubtreeReads();
  });

  it("T2 makes no bill, KPI-detail, generated, trend-strip or segment-views read at the station", async () => {
    await theStationMakesNoStationItselfRead();
  });

  it("T3 names the station only in the resolve on /assets", async () => {
    await theStationAssetsReadsOnlyTheResolve();
  });
});
