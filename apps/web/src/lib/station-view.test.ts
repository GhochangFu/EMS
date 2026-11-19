import { describe, it } from "vitest";

import {
  runStationTabsAllUndefined,
  runStationTabsDropsPageSegments,
  runStationTabsLeavesTheDtoAlone,
  runStationTabsSameKeys,
  runStationTabsSecondOnlyKeyComesAfter,
  runStationTabsSkipsUndefined,
} from "./station-view.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("F4.240 part b stationTabs (ADR 0140 decision 3e, plan D8)", () => {
  it("ST-T1 two dashboards with the same keys give one entry per key, in sortOrder", () => {
    runStationTabsSameKeys();
  });

  it("ST-T2 a key only the second site holds comes after the first site's keys", () => {
    runStationTabsSecondOnlyKeyComesAfter();
  });

  it("ST-T3 the assets and trends keys are dropped", () => {
    runStationTabsDropsPageSegments();
  });

  it("ST-T4 an undefined entry is skipped", () => {
    runStationTabsSkipsUndefined();
  });

  it("ST-T5 every entry undefined gives []", () => {
    runStationTabsAllUndefined();
  });

  it("ST-T6 the DTO's tab order is left alone", () => {
    runStationTabsLeavesTheDtoAlone();
  });
});
