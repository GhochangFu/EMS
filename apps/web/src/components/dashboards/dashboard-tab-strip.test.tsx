// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aTabDrawsTheFocusOutline,
  arrowLeftOnTheFirstTabWrapsToTheLast,
  arrowRightSelectsAndFocusesTheNextTab,
  endSelectsTheLastTab,
  everyTabControlsTheLabelledPanel,
  homeSelectsTheFirstTab,
  onlyTheSelectedTabIsInTheTabOrder,
  theTablistIsNotANavLandmark,
} from "./dashboard-tab-strip.spec";

/**
 * `F3.73` critique fix — Vitest wrapper for the dashboard tab strip (ADR 0014). One claim per
 * `it()`, so a mutation of one key's case cannot hide another's.
 */
describe("F3.73 dashboard tab strip", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps only the selected tab in the tab order", () => {
    onlyTheSelectedTabIsInTheTabOrder();
  });

  it("ArrowRight selects and focuses the next tab", async () => {
    await arrowRightSelectsAndFocusesTheNextTab();
  });

  it("ArrowLeft on the first tab wraps to the last", async () => {
    await arrowLeftOnTheFirstTabWrapsToTheLast();
  });

  it("Home selects the first tab", async () => {
    await homeSelectsTheFirstTab();
  });

  it("End selects the last tab", async () => {
    await endSelectsTheLastTab();
  });

  it("every tab controls the panel, labelled by the selected tab", () => {
    everyTabControlsTheLabelledPanel();
  });

  it("the tablist is not a nav landmark", () => {
    theTablistIsNotANavLandmark();
  });

  it("a tab draws the --focus outline on keyboard focus", () => {
    aTabDrawsTheFocusOutline();
  });
});
