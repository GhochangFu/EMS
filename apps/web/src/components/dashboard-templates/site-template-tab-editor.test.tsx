// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aKeyRefusalDoesNotPassToTheNextTab,
  aProblemShowsOnItsTab,
  aTabSwitchShowsOnlyThatTabsWidgets,
  anUnchangedKeyIsNoEdit,
  removingTheMiddleTabSelectsThePreviousTab,
  addTabAppendsAndSelects,
  addWidgetGrowsTheSelectedTab,
  moveReordersTheStrip,
  noTabsOffersAddTab,
  readOnlyRendersNoInputs,
  removeAsksThenRemoves,
  tabFieldsEditTheSelectedTab,
} from "./site-template-tab-editor.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from the file it collects
 * (ADR 0042 decision 2).
 */
describe("F4.320 site template tab editor", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a tab switch shows only that tab's widgets", async () => {
    await aTabSwitchShowsOnlyThatTabsWidgets();
  });

  it("Add tab appends and selects a tab, and is disabled at MAX_DASHBOARD_TABS", async () => {
    await addTabAppendsAndSelects();
  });

  it("Remove tab asks first, names its widgets, then removes the tab and its widgets", async () => {
    await removeAsksThenRemoves();
  });

  it("removing the selected middle tab selects the tab before it", async () => {
    await removingTheMiddleTabSelectsThePreviousTab();
  });

  it("a key refusal does not pass to the tab that lands at its index", async () => {
    await aKeyRefusalDoesNotPassToTheNextTab();
  });

  it("an unchanged key sends no edit; a refused key on blur shows the saved key", async () => {
    await anUnchangedKeyIsNoEdit();
  });

  it("Move up and Move down reorder the strip", async () => {
    await moveReordersTheStrip();
  });

  it("label, key, domain and group code edit the selected tab; a taken key is refused", async () => {
    await tabFieldsEditTheSelectedTab();
  });

  it("Add widget to this tab grows the selected tab only", async () => {
    await addWidgetGrowsTheSelectedTab();
  });

  it("a problem shows on the tab it names only", () => {
    aProblemShowsOnItsTab();
  });

  it("editable=false renders no inputs", async () => {
    await readOnlyRendersNoInputs();
  });

  it("a template with no tabs offers Add tab", async () => {
    await noTabsOffersAddTab();
  });
});
