import { describe, it } from "vitest";

import {
  acceptsATabbedBody,
  acceptsMoreThanTheCapAcrossTwoTabs,
  refusesAnUnrecognizedTabField,
  refusesATabKeyOnAnEmptyTabList,
  refusesATabKeyWhenTabsAreAbsent,
  refusesAWidgetNamingAnUnknownTab,
  refusesAWidgetWithoutATabKeyWhenTheBodyHasTabs,
  refusesMoreThanMaxTabs,
  refusesMoreThanTheCapOnOneTab,
  refusesMoreThanTheCapOnTheLegacyCanvas,
  refusesTheReservedAssetsKey,
  refusesTwoTabsWithOneId,
  refusesTwoTabsWithOneKey,
} from "./dashboard-writes.tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.73 — PUT /dashboards/:id/widgets carries tabs (plan D2)", () => {
  it("accepts a tabbed body", () => {
    acceptsATabbedBody();
  });

  it("refuses a widget naming an unknown tab", () => {
    refusesAWidgetNamingAnUnknownTab();
  });

  it("refuses a widget without a tabKey when the body has tabs", () => {
    refusesAWidgetWithoutATabKeyWhenTheBodyHasTabs();
  });

  it("refuses two tabs with one key", () => {
    refusesTwoTabsWithOneKey();
  });

  it("refuses two tabs with one stored id, without echoing the id", () => {
    refusesTwoTabsWithOneId();
  });

  it("refuses a tabKey on tabs: []", () => {
    refusesATabKeyOnAnEmptyTabList();
  });

  it("refuses a tabKey when tabs are absent", () => {
    refusesATabKeyWhenTabsAreAbsent();
  });

  it("refuses one widget over the cap on one tab", () => {
    refusesMoreThanTheCapOnOneTab();
  });

  it("accepts one widget over the cap across two tabs", () => {
    acceptsMoreThanTheCapAcrossTwoTabs();
  });

  it("refuses one widget over the cap on the legacy canvas", () => {
    refusesMoreThanTheCapOnTheLegacyCanvas();
  });

  it("refuses more than MAX_DASHBOARD_TABS tabs", () => {
    refusesMoreThanMaxTabs();
  });

  it("refuses the reserved assets key", () => {
    refusesTheReservedAssetsKey();
  });

  it("refuses an unrecognized tab field", () => {
    refusesAnUnrecognizedTabField();
  });
});
