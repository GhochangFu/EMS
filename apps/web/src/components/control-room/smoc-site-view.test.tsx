// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aDisallowedTabKeepsTheStrip,
  aDisallowedTabMountsNoContent,
  aDisallowedTabMountsNoProvider,
  aDisallowedTabShowsTheScopedOutCard,
  anHvacOnlyScopeShowsTwoTabs,
  cleanupView,
  noOtherContentMounts,
  oneProviderServesEveryTab,
  theActiveTabIsTheOnlyCurrentLink,
  theChosenContentMounts,
  theProviderTakesTheCrConstants,
  theStripListsTheSevenTabsInOrder,
} from "./smoc-site-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.70 U4 SmocSiteView", () => {
  afterEach(() => {
    cleanupView();
  });

  it("T1 lists the seven tabs in order, each linking to its absolute tab path", () => {
    theStripListsTheSevenTabsInOrder();
  });

  it("T2 marks only the active tab with aria-current=page", () => {
    theActiveTabIsTheOnlyCurrentLink();
  });

  it("T3a mounts the chosen tab's content", () => {
    theChosenContentMounts();
  });

  it("T3b mounts no other tab's content", () => {
    noOtherContentMounts();
  });

  it("T4 shows only overview and hvac for an HVAC-only scope", () => {
    anHvacOnlyScopeShowsTwoTabs();
  });

  it("T5a shows the scoped-out card for a tab outside the per-area rule", () => {
    aDisallowedTabShowsTheScopedOutCard();
  });

  it("T5b mounts no content for a tab outside the per-area rule", () => {
    aDisallowedTabMountsNoContent();
  });

  it("T6 keeps the allowed strip above the scoped-out card", () => {
    aDisallowedTabKeepsTheStrip();
  });

  it("T7a wraps the content in one provider with the CR asset codes and point keys", () => {
    theProviderTakesTheCrConstants();
  });

  it("T7b mounts no provider for a tab outside the per-area rule", () => {
    aDisallowedTabMountsNoProvider();
  });

  it("T8 keeps one provider mounted when the tab switches from hvac to ups", () => {
    oneProviderServesEveryTab();
  });
});
