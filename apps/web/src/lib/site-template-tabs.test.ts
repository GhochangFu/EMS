import { describe, it } from "vitest";

import {
  aBlankWidgetIsAValidTemplateWidget,
  aSchemaRefusalNamesItsTab,
  addAppendsAFreshTab,
  addRefusesAtTheCap,
  domainAndGroupCodeSetOneTab,
  firstTabProblemPicksTheFirstTabLine,
  moveSwapsAndRenumbers,
  rekeyLeavesOtherReferences,
  rekeyMovesTheReferences,
  rekeyRefusesAnUnusableKey,
  removeTakesTheTabAndItsWidgets,
  renameSetsOneLabel,
  tabIndexOfProblemReadsThePath,
  withTabWidgetsReplacesOneTab,
} from "./site-template-tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.320 site template tab edits", () => {
  it("add appends a fresh tab-N with no domain and renumbers", () => addAppendsAFreshTab());
  it("add refuses at MAX_DASHBOARD_TABS", () => addRefusesAtTheCap());
  it("rename sets one tab's label", () => renameSetsOneLabel());
  it("a re-key moves the card's targetTabKey and the mimic's tabKey", () => rekeyMovesTheReferences());
  it("a re-key leaves a reference to another tab alone", () => rekeyLeavesOtherReferences());
  it("a re-key refuses a taken, reserved or malformed key", () => rekeyRefusesAnUnusableKey());
  it("move swaps neighbours and renumbers", () => moveSwapsAndRenumbers());
  it("remove takes the tab and its widgets", () => removeTakesTheTabAndItsWidgets());
  it("domain and group code set one tab", () => domainAndGroupCodeSetOneTab());
  it("withTabWidgets replaces one tab's widgets", () => withTabWidgetsReplacesOneTab());
  it("a blank widget is a valid template widget", () => aBlankWidgetIsAValidTemplateWidget());
  it("tabIndexOfProblem reads content.tabs.<i> only", () => tabIndexOfProblemReadsThePath());
  it("firstTabProblem picks the first line that names a tab", () => firstTabProblemPicksTheFirstTabLine());
  it("a real schema refusal of a tab widget names its tab", () => aSchemaRefusalNamesItsTab());
});
