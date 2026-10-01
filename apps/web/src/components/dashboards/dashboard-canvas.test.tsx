// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  above1024KeepsStoredPlacement,
  aDesktopMimicGrowsAndPushesTheTileBelow,
  aDesktopMimicNeverShrinks,
  aNarrowMimicTakesItsAspectRows,
  aRemountedRootIsMeasured,
  aReportedAspectReachesTheTile,
  arrangingCanvasStays72,
  at1024TilesSpanHalfOrAll,
  at640EveryTileSpansTheGrid,
  aTileRootFillsItsCell,
  belowABreakpointTilesFlowInReadingOrder,
  cleanupCanvas,
  installFakeResizeObserver,
  measured1168PxFollowsTheWidth,
  measured1650PxGivesTheCap,
  narrowWidthClampsTo64,
  noResizeObserverGives72,
  removeResizeObserver,
  theBuilderAndNoMeasurementKeepStoredPlacement,
  theBuilderKeepsTheMimicRows,
} from "./dashboard-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.73 DashboardCanvas row height", () => {
  afterEach(() => {
    cleanupCanvas();
  });

  it("C1 a measured 1168 px view canvas gets round(columnWidth * 0.75) = 68 px rows", () => {
    installFakeResizeObserver();
    measured1168PxFollowsTheWidth();
  });

  it("C2 a measured 1650 px view canvas gets the 84 px cap", () => {
    installFakeResizeObserver();
    measured1650PxGivesTheCap();
  });

  it("C3 a narrow view canvas clamps its rows to 64 px", () => {
    installFakeResizeObserver();
    narrowWidthClampsTo64();
  });

  it("C4 the arranging (builder) canvas keeps 72 px rows at any width", () => {
    installFakeResizeObserver();
    arrangingCanvasStays72();
  });

  it("C5 with no ResizeObserver a view canvas keeps 72 px rows", () => {
    removeResizeObserver();
    noResizeObserverGives72();
  });

  it("C6 a canvas mounted on a new root measures the new root", () => {
    installFakeResizeObserver();
    aRemountedRootIsMeasured();
  });
});

describe("F3.73 critique fixes — view-mode breakpoints", () => {
  it("B1 above 1024 px the stored rectangles stand", () => {
    above1024KeepsStoredPlacement();
  });

  it("B2 at 1024 px a tile spans half the grid or all of it", () => {
    at1024TilesSpanHalfOrAll();
  });

  it("B3 below a breakpoint tiles flow in reading order", () => {
    belowABreakpointTilesFlowInReadingOrder();
  });

  it("B4 at 640 px every tile spans the grid; at 641 px not", () => {
    at640EveryTileSpansTheGrid();
  });

  it("B5 the builder and an unmeasured canvas keep the stored placement", () => {
    theBuilderAndNoMeasurementKeepStoredPlacement();
  });
});

describe("F3.73 critique fixes — aspect rows and cell fill", () => {
  afterEach(() => {
    cleanupCanvas();
  });

  it("M1 a desktop mimic grows to its aspect rows and pushes the tile below", () => {
    aDesktopMimicGrowsAndPushesTheTileBelow();
  });

  it("M2 a desktop mimic never shrinks below its stored rows", () => {
    aDesktopMimicNeverShrinks();
  });

  it("M3 a narrow mimic takes exactly its aspect rows", () => {
    aNarrowMimicTakesItsAspectRows();
  });

  it("M4 the builder keeps the mimic's stored rows", () => {
    theBuilderKeepsTheMimicRows();
  });

  it("M5 an aspect reported through useCanvasTileAspect reaches the tile's grid row", () => {
    installFakeResizeObserver();
    aReportedAspectReachesTheTile();
  });

  it("E1 a tile's root fills its cell", () => {
    aTileRootFillsItsCell();
  });
});
