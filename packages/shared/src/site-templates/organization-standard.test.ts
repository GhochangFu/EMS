import { describe, it } from "vitest";

import {
  everySourceIsAValidCatalogWrite,
  exactlyTheLoadAndAlarmTilesCompare,
  itHoldsFourteenTilesAndTheCostChartAndNoTabs,
  theContentFitsTheOrganizationTarget,
  theCostTilesTypeNoUnit,
  theEnergyCostTodayTileReadsTheReadTimeCost,
  theEntryIsTheOrganizationTargetStockRow,
  theEntryParsesUnderTheStockContract,
  theOpenAlarmsTileBindsTheOpenAndTheCriticalCount,
  theTilesAreDecisionSixInOrder,
  theTilesSitFourToARow,
  theWaterTodayTileSumsTheIntakeStageOnly,
} from "./organization-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the stock organization strip (ADR 0112 decisions 3 and 6)", () => {
  it("is the organization-standard organization-target stock row, version 3", () => {
    theEntryIsTheOrganizationTargetStockRow();
  });
  it("parses under the stock contract and the content schema", () => {
    theEntryParsesUnderTheStockContract();
  });
  it("fits the organization target rule", () => {
    theContentFitsTheOrganizationTarget();
  });
  it("holds fourteen value tiles and the daily cost chart, no tabs and no role binding", () => {
    itHoldsFourteenTilesAndTheCostChartAndNoTabs();
  });
  it("binds only sources the dashboard write path accepts", () => {
    everySourceIsAValidCatalogWrite();
  });
  it("holds decision 6's tiles in order", () => {
    theTilesAreDecisionSixInOrder();
  });
  it("binds the open and the critical alarm count on the Open alarms tile (ruling Q1b)", () => {
    theOpenAlarmsTileBindsTheOpenAndTheCriticalCount();
  });
  it("sums the intake stage only on the Water today tile (Amendment 2)", () => {
    theWaterTodayTileSumsTheIntakeStageOnly();
  });
  it("reads today's energy cost at read time, and no stored energy cost point (Amendment 4)", () => {
    theEnergyCostTodayTileReadsTheReadTimeCost();
  });
  it("compares to yesterday on Total load and Open alarms only", () => {
    exactlyTheLoadAndAlarmTilesCompare();
  });
  it("types no unit on a cost tile", () => {
    theCostTilesTypeNoUnit();
  });
  it("sits four tiles to a row", () => {
    theTilesSitFourToARow();
  });
});
