import { describe, it } from "vitest";

import {
  everyMimicDrawsItsTabsPreset,
  everyModuleCardNamesATab,
  everyTabPresetIsAPresetOption,
  everyWidgetFitsTheBuilderRow,
  everyDomainTabWidgetHasItsCompactSize,
  noTabHoldsMoreThanTheWidgetCap,
  noTabLeavesAnEmptyRow,
  noTwoWidgetsInATabOverlap,
  theTabsTotalTheirCompactRows,
  theContentFitsTheSiteTarget,
  theContentParsesUnderTheContentSchema,
  theEntryIsTheSiteTargetStockRow,
  theEntryParsesUnderTheStockContract,
  theOfflineTileUsesTheOfflineIcon,
  theElectricalTabDrawsTheSingleLineAndOneBreakerTable,
  theOverviewHoldsItsV4Rects,
  theOverviewHoldsNoCardAndOneSystemsList,
  theOverviewMimicNamesTheElectricalTabCompactly,
  theTabsAreThePlanOrder,
  theValueNamesNoControlRoomAssetCode,
} from "./smoc-standard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — the SMOC standard site layout (plan D8)", () => {
  it("is the smoc-standard site-target stock row, version 4", () => {
    theEntryIsTheSiteTargetStockRow();
  });
  it("holds the v4 Overview rects (F3.74, ADR 0088 Amendment 2)", () => {
    theOverviewHoldsItsV4Rects();
  });
  it("gives each domain-tab widget its compact v2 size", () => {
    everyDomainTabWidgetHasItsCompactSize();
  });
  it("gives the legend and a value tile the rows they need on the builder's 72 px row", () => {
    everyWidgetFitsTheBuilderRow();
  });
  it("overlaps no two widgets in a tab", () => {
    noTwoWidgetsInATabOverlap();
  });
  it("leaves no empty row in a tab", () => {
    noTabLeavesAnEmptyRow();
  });
  it("totals 12 rows on the Overview, 19 on the electrical tab and 14 on another tab with a mimic", () => {
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
  it("holds no module card and one Critical systems list beside the rail on the Overview (F3.77 D1)", () => {
    theOverviewHoldsNoCardAndOneSystemsList();
  });
  it("draws the offline icon on the Offline assets tile (F3.77)", () => {
    theOfflineTileUsesTheOfflineIcon();
  });
  it("holds at most the widget cap in each tab", () => {
    noTabHoldsMoreThanTheWidgetCap();
  });
  it("names the electrical tab from a compact Overview diagram (F3.74)", () => {
    theOverviewMimicNamesTheElectricalTabCompactly();
  });
  it("draws the single line and one breaker table on the electrical tab (F3.74)", () => {
    theElectricalTabDrawsTheSingleLineAndOneBreakerTable();
  });
  it("spells no control-room asset code in its value", () => {
    theValueNamesNoControlRoomAssetCode();
  });
});
