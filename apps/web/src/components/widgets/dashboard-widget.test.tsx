// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedValueTileShowsTheTilesOwnFailureLine,
  aLiveTankWithNoReadingSaysSoInsideTheVessel,
  aReadyTankShowsItsPercentageAndNamesTheVessel,
  aReadyValueTileShowsTheFormattedReadingAndItsUnit,
  aReadyWidgetShowsNoPlaceholder,
  aValueTileDrawsOneCardWithOneHeading,
  anUntitledWidgetFallsBackToItsCatalogLabel,
  eachNonReadyStateReplacesTheWidgetBody,
  everyCatalogTypeDrawsItsTitle,
} from "./dashboard-widget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1c widget rendering", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("draws a title for every type in the catalog", () => {
    everyCatalogTypeDrawsItsTitle();
  });

  it("falls back to the catalog label when a widget has no title", () => {
    anUntitledWidgetFallsBackToItsCatalogLabel();
  });

  it("shows a ready tank's percentage and names the vessel", () => {
    aReadyTankShowsItsPercentageAndNamesTheVessel();
  });

  it("says so inside the vessel when a live tank has no reading", () => {
    aLiveTankWithNoReadingSaysSoInsideTheVessel();
  });

  it("replaces the widget body in each non-ready state, rather than drawing over it", () => {
    eachNonReadyStateReplacesTheWidgetBody();
  });

  it("shows no placeholder once a widget is ready", () => {
    aReadyWidgetShowsNoPlaceholder();
  });

  it("draws one card with one heading for a value tile", () => {
    aValueTileDrawsOneCardWithOneHeading();
  });

  it("shows a ready value tile's formatted reading and its unit", () => {
    aReadyValueTileShowsTheFormattedReadingAndItsUnit();
  });

  it("shows the tile's own failure line when a value tile fails", () => {
    aFailedValueTileShowsTheTilesOwnFailureLine();
  });
});
