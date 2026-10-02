// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  above1024KeepsStoredPlacement,
  aDesktopMimicGetsItsAspectMinHeight,
  aNarrowMimicGetsItsAspectMinHeight,
  aRemountedRootIsMeasured,
  aReportedAspectReachesTheTile,
  arrangingCanvasStays72,
  aTallTileSpansTheTracksBesideIt,
  at1024TilesSpanHalfOrAll,
  at640EveryTileSpansTheGrid,
  aTileRootFillsItsCell,
  belowABreakpointTilesFlowInReadingOrder,
  cleanupCanvas,
  emptyStoredRowsAddNoTrack,
  installFakeResizeObserver,
  measured1168PxViewRowsAreAuto,
  measured1650PxViewRowsAreAuto,
  noResizeObserverBuilderStays72,
  noResizeObserverViewRowsAreAuto,
  removeResizeObserver,
  theBuilderAndNoMeasurementKeepStoredPlacement,
  theBuilderKeepsTheMimicRows,
  theOverviewShapeGivesFourTracks,
} from "./dashboard-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.77 follow-up DashboardCanvas row tracks", () => {
  afterEach(() => {
    cleanupCanvas();
  });

  it("V1a a measured 1168 px view canvas sizes its rows to content (auto)", () => {
    installFakeResizeObserver();
    measured1168PxViewRowsAreAuto();
  });

  it("V1b a measured 1650 px view canvas sizes its rows to content (auto)", () => {
    installFakeResizeObserver();
    measured1650PxViewRowsAreAuto();
  });

  it("C4 the arranging (builder) canvas keeps 72 px rows at any width", () => {
    installFakeResizeObserver();
    arrangingCanvasStays72();
  });

  it("V2a with no ResizeObserver a view canvas sizes its rows to content", () => {
    removeResizeObserver();
    noResizeObserverViewRowsAreAuto();
  });

  it("V2b with no ResizeObserver the builder keeps 72 px rows", () => {
    removeResizeObserver();
    noResizeObserverBuilderStays72();
  });

  it("C6 a canvas mounted on a new root measures the new root", () => {
    installFakeResizeObserver();
    aRemountedRootIsMeasured();
  });
});

describe("F3.77 follow-up — compacted row tracks", () => {
  it("R1 stored rows no tile covers add no track", () => {
    emptyStoredRowsAddNoTrack();
  });

  it("R2 a tall tile beside two stacked tiles spans both of their tracks", () => {
    aTallTileSpansTheTracksBesideIt();
  });

  it("R3 the Overview shape compacts to four tracks", () => {
    theOverviewShapeGivesFourTracks();
  });
});

describe("F3.73 critique fixes — view-mode breakpoints", () => {
  it("B1 above 1024 px the stored columns stand and the rows compact", () => {
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

  it("B5 the builder keeps the stored placement; an unmeasured canvas compacts its rows", () => {
    theBuilderAndNoMeasurementKeepStoredPlacement();
  });
});

describe("F3.77 follow-up — aspect minimum height and cell fill", () => {
  afterEach(() => {
    cleanupCanvas();
  });

  it("M1 a desktop mimic gets its aspect minimum height; the tile below gets none", () => {
    aDesktopMimicGetsItsAspectMinHeight();
  });

  it("M3 a narrow full-width mimic gets its aspect minimum height on an auto row", () => {
    aNarrowMimicGetsItsAspectMinHeight();
  });

  it("M4 the builder keeps the mimic's stored rows and no minimum height", () => {
    theBuilderKeepsTheMimicRows();
  });

  it("M5 an aspect reported through useCanvasTileAspect reaches the tile's min-height", () => {
    installFakeResizeObserver();
    aReportedAspectReachesTheTile();
  });

  it("E1 a tile's root fills its cell", () => {
    aTileRootFillsItsCell();
  });
});
