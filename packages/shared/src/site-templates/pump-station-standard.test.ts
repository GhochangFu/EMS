import { describe, it } from "vitest";

import {
  aPheStationKeepsEveryTab,
  eachTabDrawsItsPumpStationPreset,
  noWidgetsOverlap,
  theElectricalTabCarriesTheCostRow,
  theEntryIsTheSiteTargetStockRow,
  theTabsAreOverviewElectricalAndEnvironment,
} from "./pump-station-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.319 — the pump-station standard site layout (ADR 0113 decision 7)", () => {
  it("is a site-target stock row at version 2 that parses", () => {
    theEntryIsTheSiteTargetStockRow();
  });
  it("holds the Overview, Electrical and Environment tabs, the Overview on pump-station", () => {
    theTabsAreOverviewElectricalAndEnvironment();
  });
  it("draws one pump-station preset per tab", () => {
    eachTabDrawsItsPumpStationPreset();
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
