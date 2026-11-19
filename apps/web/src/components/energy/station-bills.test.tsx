// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aCurrencyMismatchShowsNoTotal,
  aRejectedSiteBillShowsNoTotal,
  choosingAMonthRereadsBothSites,
  cleanupBills,
  everySiteUnmappedRendersNothing,
  oneCardPerSiteAndOneSelector,
  theTotalAddsNoRead,
  theTotalIsTheSumOfTheSiteBills,
} from "./station-bills.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.240 part b StationBills (ADR 0140 decision 3f, plan D10, D11)", () => {
  afterEach(() => {
    cleanupBills();
  });

  it("B1 one card per site, titled by site, under one month selector", async () => {
    await oneCardPerSiteAndOneSelector();
  });

  it("B2 the station total is the site totals added, labelled as a sum", async () => {
    await theTotalIsTheSumOfTheSiteBills();
  });

  it("B3 a currency mismatch reads — with the sentence", async () => {
    await aCurrencyMismatchShowsNoTotal();
  });

  it("B4 a rejected site bill reads — and names the site", async () => {
    await aRejectedSiteBillShowsNoTotal();
  });

  it("B5 choosing a month re-reads both sites for that month", async () => {
    await choosingAMonthRereadsBothSites();
  });

  it("B6 the total adds no read and never reads the station", async () => {
    await theTotalAddsNoRead();
  });

  it("B7 every site unmapped for the current month renders nothing", async () => {
    await everySiteUnmappedRendersNothing();
  });
});
