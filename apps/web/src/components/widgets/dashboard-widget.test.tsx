// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedValueTileShowsTheTilesOwnFailureLine,
  aFreshReadyWidgetShowsNoOfflineBadge,
  aLiveTankWithNoReadingSaysSoInsideTheVessel,
  aReadyTankShowsItsPercentageAndNamesTheVessel,
  aReadyValueTileShowsTheFormattedReadingAndItsUnit,
  aHealthScoreTileShowsAPercentage,
  aReadyWidgetShowsNoPlaceholder,
  aStaleReadyValueTileShowsKpiTilesOwnStaleNote,
  aStaleReadyWidgetSaysOfflineWithoutHidingTheReading,
  aValueTileDrawsOneCardWithOneHeading,
  anUntitledWidgetFallsBackToItsCatalogLabel,
  eachNonReadyStateReplacesTheWidgetBody,
  everyCatalogTypeDrawsItsTitle,
  aValueTileWithAShortfallRendersTheCoverageNote,
  aValueTileWithFullCoverageRendersNoNote,
  aMimicDispatchedWithoutItsReadDrawsThePresetUnresolved,
  aLayoutMimicDispatchedWithoutItsReadDrawsNothing,
  aNonReadySiteWidgetDrawsThePlaceholderNotItsBody,
  theFiveSiteWidgetsDispatchedWithoutTheirReadDrawTheirOwnEmptyState,
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

  it("says Offline on a stale WidgetFrame widget without hiding the reading", () => {
    aStaleReadyWidgetSaysOfflineWithoutHidingTheReading();
  });

  it("shows no Offline badge on a fresh, ready WidgetFrame widget", () => {
    aFreshReadyWidgetShowsNoOfflineBadge();
  });

  it("shows KpiTile's own stale note on a stale value tile", () => {
    aStaleReadyValueTileShowsKpiTilesOwnStaleNote();
  });

  it("F3.32 draws a mimic dispatched without its node read as the preset, every node unresolved", () => {
    aMimicDispatchedWithoutItsReadDrawsThePresetUnresolved();
  });

  it("F3.32c draws a layout mimic dispatched without its node read as an empty drawing, without throwing", () => {
    aLayoutMimicDispatchedWithoutItsReadDrawsNothing();
  });

  it("F3.73 draws each site widget dispatched without its read as its own empty state", () => {
    theFiveSiteWidgetsDispatchedWithoutTheirReadDrawTheirOwnEmptyState();
  });

  it("F3.73 draws the frame placeholder, not the body, for a non-ready site widget", () => {
    aNonReadySiteWidgetDrawsThePlaceholderNotItsBody();
  });
});

describe("E4.2 — roll-up coverage on a value tile", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the coverage note when fewer assets are fresh than carry the code", () => {
    aValueTileWithAShortfallRendersTheCoverageNote();
  });

  it("renders no note when every carrying asset is fresh, and still renders the value", () => {
    aValueTileWithFullCoverageRendersNoNote();
  });

  it("F3.73: a health-score value tile shows a percentage", () => {
    aHealthScoreTileShowsAPercentage();
  });
});
