import { describe, it } from "vitest";

import {
  everySourceIsAValidCatalogWrite,
  exactlyTheLoadAndAlarmTilesCompare,
  itHoldsFifteenTilesAndTheCostChartAndNoTabs,
  theContentFitsTheOrganizationTarget,
  theCostTilesTypeNoUnit,
  theEntryIsTheOrganizationTargetStockRow,
  theEntryParsesUnderTheStockContract,
  theOpenAlarmsTileBindsTheOpenAndTheCriticalCount,
  theTilesAreDecisionSixInOrder,
  theTilesSitFourToARow,
  theWaterTodayTileSumsTheIntakeStageOnly,
} from "./organization-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the stock organization strip (ADR 0112 decisions 3 and 6)", () => {
  it("is the organization-standard organization-target stock row, version 2", () => {
    theEntryIsTheOrganizationTargetStockRow();
  });
  it("parses under the stock contract and the content schema", () => {
    theEntryParsesUnderTheStockContract();
  });
  it("fits the organization target rule", () => {
    theContentFitsTheOrganizationTarget();
  });
  it("holds fifteen value tiles and the daily cost chart, no tabs and no role binding", () => {
    itHoldsFifteenTilesAndTheCostChartAndNoTabs();
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
