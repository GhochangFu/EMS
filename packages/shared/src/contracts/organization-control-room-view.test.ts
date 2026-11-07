import { describe, it } from "vitest";

import {
  theStripHoldsTilesAndTheDailyCostChartOnly,
  anUnknownCatalogKeyIsRefused,
  anUnknownKindIsRefused,
  theDashboardViewParses,
  theLayoutResultParses,
  thePutBodyIsStrict,
  theStockViewParses,
} from "./organization-control-room-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — organization Control Room view contracts (ADR 0112 decisions 3, 4)", () => {
  it("the stock view parses: no dashboard, a two-source tile with one unresolved source", () => {
    theStockViewParses();
  });

  it("the dashboard view parses with the copy's id and slug", () => {
    theDashboardViewParses();
  });

  it("refuses a kind that is not stock or dashboard", () => {
    anUnknownKindIsRefused();
  });

  it("refuses an unknown catalog key on a tile source", () => {
    anUnknownCatalogKeyIsRefused();
  });

  it("the PUT body takes an optional templateId and nothing else", () => {
    thePutBodyIsStrict();
  });

  it("the layout result names the organization, the dashboard and the template", () => {
    theLayoutResultParses();
  });

  it("holds value tiles and the daily cost chart only (F4.332)", () => {
    theStripHoldsTilesAndTheDailyCostChartOnly();
  });
});
