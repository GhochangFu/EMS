// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import {
  aBoundTabIsNotMislabelledWhileTheGroupsLoad,
  aCatalogBoundTileNamesItsMetric,
  aProblemOnAnotherTabNamesAndSelectsIt,
  aSaveRefreshesTheTabMarkers,
  theRemoveButtonsNameIsItsVisibleText,
  aDisabledGroupsReadDoesNotMislabelABoundTab,
  aFailedGroupsReadShowsItsErrorNotAMisleadingLabel,
  aLoadedListWithoutTheBoundGroupSaysAnotherSite,
  aGroupTabOffALocationScopeBlocksTheSave,
  aLocationMoveWithSavedGroupTabsBlocksTheSave,
  aNewWidgetLandsOnTheSelectedTab,
  aNewMimicOnOverviewResolvesThroughTheGroupTab,
  aReservedTabKeyBlocksTheSave,
  aTakenTabKeyIsRefusedAtTheField,
  addingATabSendsItWithItsWidget,
  bindingATabToAGroupReadsTheSitesGroups,
  movingAWidgetToAnotherTab,
  onlyAStoredTabCarriesItsMarker,
  theStripShowsTheSelectedTabsWidgetsOnly,
} from "./dashboard-builder-edit-page-tabs.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.73 D11 dashboard builder edit page — tabs", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
  });

  it("the strip shows the selected tab's widgets only", async () => {
    await theStripShowsTheSelectedTabsWidgetsOnly();
  });

  it("adding a tab sends it with its widget", async () => {
    await addingATabSendsItWithItsWidget();
  });

  it("binding a tab to a group reads the site's groups", async () => {
    await bindingATabToAGroupReadsTheSitesGroups();
  });

  it("moving a widget to another tab", async () => {
    await movingAWidgetToAnotherTab();
  });

  it("a new widget lands on the selected tab, and a group tab offers the plant mimic", async () => {
    await aNewWidgetLandsOnTheSelectedTab();
  });

  it("F3.74 review 7c: a new mimic on Overview resolves through the group tab by default", async () => {
    await aNewMimicOnOverviewResolvesThroughTheGroupTab();
  });

  it("a reserved tab key blocks the save", async () => {
    await aReservedTabKeyBlocksTheSave();
  });

  it("a taken tab key is refused at the field", async () => {
    await aTakenTabKeyIsRefusedAtTheField();
  });

  it("a location move with saved group tabs blocks the save, even with the groups cleared", async () => {
    await aLocationMoveWithSavedGroupTabsBlocksTheSave();
  });

  it("a group tab off a location scope blocks the save, and the panel clears the tab's reason", async () => {
    await aGroupTabOffALocationScopeBlocksTheSave();
  });

  it("a bound tab is not labelled 'another site' while the site's groups load", async () => {
    await aBoundTabIsNotMislabelledWhileTheGroupsLoad();
  });

  it("a failed groups read shows its error, not a misleading label", async () => {
    await aFailedGroupsReadShowsItsErrorNotAMisleadingLabel();
  });

  it("a disabled groups read (asset_group_admin) does not mislabel a bound tab", async () => {
    await aDisabledGroupsReadDoesNotMislabelABoundTab();
  });

  it("a loaded list without the bound group says 'another site'", async () => {
    await aLoadedListWithoutTheBoundGroupSaysAnotherSite();
  });

  it("F3.73 critique: the remove button's accessible name is its visible text", async () => {
    await theRemoveButtonsNameIsItsVisibleText();
  });

  it("F3.73 critique: a problem on another tab names the tab, and a click selects it", async () => {
    await aProblemOnAnotherTabNamesAndSelectsIt();
  });

  it("F3.73 critique: a catalog-bound tile names its metric", async () => {
    await aCatalogBoundTileNamesItsMetric();
  });

  it("F3.77 only a stored tab carries its marker; an unsaved tab has none", async () => {
    await onlyAStoredTabCarriesItsMarker();
  });

  it("F3.77 review fix: a save refreshes the tab markers' read", async () => {
    await aSaveRefreshesTheTabMarkers();
  });
});
