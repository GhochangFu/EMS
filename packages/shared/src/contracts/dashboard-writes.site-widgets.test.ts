import { describe, it } from "vitest";

import {
  acceptsABreakerTable,
  acceptsATrendStripNamingATabOfTheRequest,
  acceptsATrendStripWithEachRange,
  acceptsEachOfTheFiveSiteWidgets,
  acceptsTheTwoAssetsCatalogEntries,
  refusesACardOnADashboardWithoutTabs,
  refusesACardTargetingAnUnknownTab,
  refusesACardWithoutATargetTabKey,
  refusesAnUnknownKeyInASiteWidgetConfig,
  refusesAPointOnABreakerTable,
  refusesAPointOnATrendStrip,
  refusesATrendStripNamingAnUnknownTab,
  refusesATrendStripWithAnUnknownRange,
  refusesAnUnknownKeyInATrendStripConfig,
  refusesAPointOnASiteWidget,
  refusesAnUnknownKeyInABreakerTableConfig,
  refusesARailBeyondTwentyRows,
  refusesParamsOnTheTwoAssetsCatalogEntries,
} from "./dashboard-writes.site-widgets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.73 — the five site widgets on PUT /dashboards/:id/widgets", () => {
  it("accepts each of the five site widgets", () => {
    acceptsEachOfTheFiveSiteWidgets();
  });

  it("refuses a module card whose targetTabKey names no tab of the request", () => {
    refusesACardTargetingAnUnknownTab();
  });

  it("refuses a module card on a dashboard without tabs", () => {
    refusesACardOnADashboardWithoutTabs();
  });

  it("refuses a module card without a targetTabKey", () => {
    refusesACardWithoutATargetTabKey();
  });

  it("refuses an undeclared key in a site widget config", () => {
    refusesAnUnknownKeyInASiteWidgetConfig();
  });

  it("refuses a point binding on a site widget", () => {
    refusesAPointOnASiteWidget();
  });

  it("accepts a breaker_table widget", () => {
    acceptsABreakerTable();
  });

  it("refuses a point binding on a breaker_table widget", () => {
    refusesAPointOnABreakerTable();
  });

  it("refuses an undeclared key in a breaker_table config", () => {
    refusesAnUnknownKeyInABreakerTableConfig();
  });

  it("accepts a trend_strip with each default range", () => {
    acceptsATrendStripWithEachRange();
  });

  it("accepts a trend_strip naming a tab of the request", () => {
    acceptsATrendStripNamingATabOfTheRequest();
  });

  it("refuses a trend_strip with an unknown range", () => {
    refusesATrendStripWithAnUnknownRange();
  });

  it("refuses an undeclared key in a trend_strip config", () => {
    refusesAnUnknownKeyInATrendStripConfig();
  });

  it("refuses a point binding on a trend_strip", () => {
    refusesAPointOnATrendStrip();
  });

  it("refuses a trend_strip naming an unknown tab", () => {
    refusesATrendStripNamingAnUnknownTab();
  });

  it("refuses a rail beyond 20 rows", () => {
    refusesARailBeyondTwentyRows();
  });

  it("accepts assets.list and assets.offline.count with empty params", () => {
    acceptsTheTwoAssetsCatalogEntries();
  });

  it("refuses params on either assets catalog entry", () => {
    refusesParamsOnTheTwoAssetsCatalogEntries();
  });
});
