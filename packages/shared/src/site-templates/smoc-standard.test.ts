import { describe, it } from "vitest";

import {
  everyMimicDrawsItsTabsPreset,
  everyModuleCardNamesATab,
  everyTabPresetIsAPresetOption,
  everyWidgetFitsTheViewCanvasFloorRow,
  everyWidgetHasItsCompactSize,
  noTabHoldsMoreThanTheWidgetCap,
  noTabLeavesAnEmptyRow,
  noTwoWidgetsInATabOverlap,
  theTabsTotalTheirCompactRows,
  theContentFitsTheSiteTarget,
  theContentParsesUnderTheContentSchema,
  theEntryIsTheSiteTargetStockRow,
  theEntryParsesUnderTheStockContract,
  theOverviewHasOneCardPerGroupTab,
  theTabsAreThePlanOrder,
  theValueNamesNoControlRoomAssetCode,
} from "./smoc-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the SMOC standard site layout (plan D8)", () => {
  it("is the smoc-standard site-target stock row, version 2", () => {
    theEntryIsTheSiteTargetStockRow();
  });
  it("gives each widget its compact v2 size", () => {
    everyWidgetHasItsCompactSize();
  });
  it("gives the legend and a value tile the rows they need at the 64 px view floor", () => {
    everyWidgetFitsTheViewCanvasFloorRow();
  });
  it("overlaps no two widgets in a tab", () => {
    noTwoWidgetsInATabOverlap();
  });
  it("leaves no empty row in a tab", () => {
    noTabLeavesAnEmptyRow();
  });
  it("totals 14 rows on the Overview and on a domain tab with a mimic", () => {
    theTabsTotalTheirCompactRows();
  });
  it("parses under the stock template contract", () => {
    theEntryParsesUnderTheStockContract();
  });
  it("parses under the content schema", () => {
    theContentParsesUnderTheContentSchema();
  });
  it("fits the site target rule", () => {
    theContentFitsTheSiteTarget();
  });
  it("orders its tabs as the plan does", () => {
    theTabsAreThePlanOrder();
  });
  it("names only mimic preset options", () => {
    everyTabPresetIsAPresetOption();
  });
  it("draws each tab's own preset, and no mimic where the tab names none", () => {
    everyMimicDrawsItsTabsPreset();
  });
  it("points every module card at a tab", () => {
    everyModuleCardNamesATab();
  });
  it("puts one module card per group tab on the Overview", () => {
    theOverviewHasOneCardPerGroupTab();
  });
  it("holds at most the widget cap in each tab", () => {
    noTabHoldsMoreThanTheWidgetCap();
  });
  it("spells no control-room asset code in its value", () => {
    theValueNamesNoControlRoomAssetCode();
  });
});
