import { describe, it } from "vitest";

import {
  aPheStationKeepsEveryTab,
  eachMimicDrawsTheIsometricSet,
  eachTabDrawsItsPumpStationPreset,
  noTrendStripHoldsASelection,
  noWidgetsOverlap,
  theElectricalTabCarriesTheCostRow,
  theEntryIsTheSiteTargetStockRow,
  theTabsAreOverviewElectricalAndEnvironment,
} from "./pump-station-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.319 — the pump-station standard site layout (ADR 0113 decision 7)", () => {
  it("is a site-target stock row at version 3 that parses", () => {
    theEntryIsTheSiteTargetStockRow();
  });
  it("holds the Overview, Electrical and Environment tabs, the Overview on pump-station", () => {
    theTabsAreOverviewElectricalAndEnvironment();
  });
  it("draws one pump-station preset per tab", () => {
    eachTabDrawsItsPumpStationPreset();
  });
  it("draws every mimic with the isometric glyph set (F4.388, ADR 0121 Amendment 2)", () => {
    eachMimicDrawsTheIsometricSet();
  });
  it("holds no point selection on any trend strip (ADR 0108 Amendment 7)", () => {
    noTrendStripHoldsASelection();
  });
  it("lays out no two widgets on one cell", () => {
    noWidgetsOverlap();
  });
  it("keeps every tab at a seeded PHE station", () => {
    aPheStationKeepsEveryTab();
  });
  it("ends the Electrical tab with the cost tiles and the daily cost chart (F4.332)", () => {
    theElectricalTabCarriesTheCostRow();
  });
});
