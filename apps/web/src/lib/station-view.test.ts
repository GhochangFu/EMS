import { describe, it } from "vitest";

import {
  runStationBillTotalFailedRead,
  runStationBillTotalNothing,
  runStationBillTotalNullCurrency,
  runStationBillTotalPending,
  runStationBillTotalReason,
  runStationBillTotalSums,
  runStationBillTotalTwoCurrencies,
  runStationBillTotalTwoMonths,
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

describe("F4.240 part b stationBillTotal (ADR 0140 decision 3f, plan D11)", () => {
  it("SB1 two priced bills in one month and currency give the sum of their totals", () => {
    runStationBillTotalSums();
  });

  it("SB2 a rejected read gives no total, naming the site", () => {
    runStationBillTotalFailedRead();
  });

  it("SB3 a bill with a reason gives no total, naming the site", () => {
    runStationBillTotalReason();
  });

  it("SB4 two months give no total", () => {
    runStationBillTotalTwoMonths();
  });

  it("SB5 two currencies give no total", () => {
    runStationBillTotalTwoCurrencies();
  });

  it("SB6 a null currency gives no total", () => {
    runStationBillTotalNullCurrency();
  });

  it("SB7 every site no_mapping gives nothing to show", () => {
    runStationBillTotalNothing();
  });

  it("SB8 a pending read gives pending", () => {
    runStationBillTotalPending();
  });
});
