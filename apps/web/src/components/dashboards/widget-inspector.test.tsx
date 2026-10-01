// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aModuleCardOffersTheDashboardsTabs,
  aModuleCardOnADashboardWithNoTabsIsDisabledWithAHint,
  aNonModuleCardHasNoTabSelect,
  aRailRowsProblemRendersUnderTheRows,
  aRailShowsItsRowsAtTheDefault,
  aSiteWidgetHidesUnitDecimalsAndBoundPoints,
  aStoredTabKeyTheDashboardNoLongerHasStaysSelected,
  aWidgetOnADashboardWithoutTabsHasNoTabSelect,
  aWidgetOnATabbedDashboardMovesThroughTheTabSelect,
  aTabProblemRendersUnderTheSelect,
  choosingATabWritesItsKeyToTheConfig,
  editingTheRailRowsWritesThemToTheConfig,
  untickingSummaryWritesItToTheConfig,
  aLayoutSourceRowHidesThePresetSelect,
  aLayoutSourceRowShowsTheLayoutSelect,
  aLayoutSourceWithNoLayoutReportsTheProblem,
  aMimicHidesTheBoundPointsField,
  aMimicHidesTheDecimalsField,
  aMimicHidesTheUnitField,
  aMimicShowsTheSourceSelectDefaultingToPreset,
  aMimicShowsThePresetSelectOnItsPreset,
  aValueTileHasNoPresetField,
  aValueTileShowsTheBoundPointsField,
  aValueTileShowsTheDecimalsField,
  aValueTileShowsTheUnitField,
  anUnlistedStoredLayoutStaysSelected,
  choosingALayoutWritesItToTheConfig,
  choosingAPresetWritesItToTheConfig,
  choosingLayoutSourceWritesItToTheConfig,
  stubFetch,
  stubMimicLayouts,
  theLayoutSelectListsLibraryNames,
  theLayoutSelectListsTheDashboardsOrganizationsLayout,
  theLayoutSelectOmitsAnotherOrganizationsLayout,
  thePresetOptionReadsThePresetLabel,
  thePresetProblemRendersUnderThePreset,
} from "./widget-inspector.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32 widget inspector — the plant mimic", () => {
  beforeEach(() => {
    stubFetch();
    // `F3.32c` — `WidgetInspector` calls `useMimicLayouts` unconditionally (rules of hooks), so
    // every case needs a resolved mock, not only the ones asserting on the Layout select.
    stubMimicLayouts();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a value tile shows the Unit field (the control for the next case)", () => {
    aValueTileShowsTheUnitField();
  });

  it("a mimic hides the Unit field", () => {
    aMimicHidesTheUnitField();
  });

  it("a value tile shows the Decimals field (the control for the next case)", () => {
    aValueTileShowsTheDecimalsField();
  });

  it("a mimic hides the Decimals field", () => {
    aMimicHidesTheDecimalsField();
  });

  it("a value tile shows the Bound points field (the control for the next case)", () => {
    aValueTileShowsTheBoundPointsField();
  });

  it("a mimic hides the Bound points field and its point picker", () => {
    aMimicHidesTheBoundPointsField();
  });

  it("a value tile has no Preset field", () => {
    aValueTileHasNoPresetField();
  });

  it("a mimic shows a Preset select on its own preset", () => {
    aMimicShowsThePresetSelectOnItsPreset();
  });

  it("the preset option reads the preset's label", () => {
    thePresetOptionReadsThePresetLabel();
  });

  it("choosing a preset writes it to the row's config", async () => {
    await choosingAPresetWritesItToTheConfig();
  });

  it("a preset problem renders under the Preset field", () => {
    thePresetProblemRendersUnderThePreset();
  });

  it("F3.32c: a new mimic row shows the Source select, defaulting to Preset", () => {
    aMimicShowsTheSourceSelectDefaultingToPreset();
  });

  it("F3.32c: choosing Layout in the Source select writes mimicSource to the config", async () => {
    await choosingLayoutSourceWritesItToTheConfig();
  });

  it("F3.32c: a layout-source row hides the Preset select", () => {
    aLayoutSourceRowHidesThePresetSelect();
  });

  it("F3.32c: a layout-source row shows the Layout select", () => {
    aLayoutSourceRowShowsTheLayoutSelect();
  });

  it("F3.32c: the Layout select lists the organization's library by name", async () => {
    await theLayoutSelectListsLibraryNames();
  });

  it("F3.32c: choosing a library layout writes its id to mimicLayoutId", async () => {
    await choosingALayoutWritesItToTheConfig();
  });

  it("F3.32c: a layout source with no layout chosen reports the layout problem", () => {
    aLayoutSourceWithNoLayoutReportsTheProblem();
  });

  it("F3.32c: the Layout select lists the dashboard's organization's layout (the control for the next case)", async () => {
    await theLayoutSelectListsTheDashboardsOrganizationsLayout();
  });

  it("F3.32c: the Layout select omits another organization's layout", async () => {
    await theLayoutSelectOmitsAnotherOrganizationsLayout();
  });

  it("F3.32c: a stored layout id the list does not hold stays the select's value", async () => {
    await anUnlistedStoredLayoutStaysSelected();
  });
});

describe("F3.73 widget inspector — the site widgets", () => {
  beforeEach(() => {
    stubFetch();
    stubMimicLayouts();
  });

  afterEach(() => {
    cleanup();
  });

  it("hides Unit, Decimals and both binding fields for each of the five", () => {
    aSiteWidgetHidesUnitDecimalsAndBoundPoints();
  });

  it("shows the rail's Rows at the default of 8", () => {
    aRailShowsItsRowsAtTheDefault();
  });

  it("writes an edited Rows value to railRows", async () => {
    await editingTheRailRowsWritesThemToTheConfig();
  });

  it("writes the Alarm Summary checkbox to railShowSummary", async () => {
    await untickingSummaryWritesItToTheConfig();
  });

  it("renders a railRows problem under the Rows field", () => {
    aRailRowsProblemRendersUnderTheRows();
  });

  it("offers a module card the dashboard's tabs", () => {
    aModuleCardOffersTheDashboardsTabs();
  });

  it("writes the chosen tab's key to targetTabKey", async () => {
    await choosingATabWritesItsKeyToTheConfig();
  });

  it("disables the tab select with a hint when the dashboard has no tabs", () => {
    aModuleCardOnADashboardWithNoTabsIsDisabledWithAHint();
  });

  it("moves a widget on a tabbed dashboard through the tab select (F3.73 D11)", async () => {
    await aWidgetOnATabbedDashboardMovesThroughTheTabSelect();
  });

  it("shows no tab select on a dashboard without tabs (F3.73 D11)", () => {
    aWidgetOnADashboardWithoutTabsHasNoTabSelect();
  });

  it("keeps a stored tab key the dashboard no longer has as the select's value", () => {
    aStoredTabKeyTheDashboardNoLongerHasStaysSelected();
  });

  it("renders a targetTabKey problem under the tab select", () => {
    aTabProblemRendersUnderTheSelect();
  });

  it("offers no tab select on a value tile (the control for the module card cases)", () => {
    aNonModuleCardHasNoTabSelect();
  });
});
