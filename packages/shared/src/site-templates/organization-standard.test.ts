import { describe, it } from "vitest";

import {
  everySourceIsAValidCatalogWrite,
  exactlyTheLoadAndAlarmTilesCompare,
  itHoldsFourteenValueTilesAndNoTabs,
  theContentFitsTheOrganizationTarget,
  theCostTilesTypeNoUnit,
  theEntryIsTheOrganizationTargetStockRow,
  theEntryParsesUnderTheStockContract,
  theOpenAlarmsTileBindsTheOpenAndTheCriticalCount,
  theTilesAreDecisionSixInOrder,
  theTilesSitFourToARow,
} from "./organization-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.317 — the stock organization strip (ADR 0112 decisions 3 and 6)", () => {
  it("is the organization-standard organization-target stock row, version 1", () => {
    theEntryIsTheOrganizationTargetStockRow();
  });
  it("parses under the stock contract and the content schema", () => {
    theEntryParsesUnderTheStockContract();
  });
  it("fits the organization target rule", () => {
    theContentFitsTheOrganizationTarget();
  });
  it("holds fourteen value tiles, no tabs and no role binding", () => {
    itHoldsFourteenValueTilesAndNoTabs();
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
