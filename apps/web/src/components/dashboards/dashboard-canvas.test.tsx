// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  arrangingCanvasStays72,
  cleanupCanvas,
  installFakeResizeObserver,
  measured1528PxGivesTheClampValue,
  narrowWidthClampsTo64,
  noResizeObserverGives72,
  removeResizeObserver,
  wideWidthClampsTo72,
} from "./dashboard-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.73 polish DashboardCanvas row height", () => {
  afterEach(() => {
    cleanupCanvas();
  });

  it("C1 a measured 1528 px view canvas gets round(columnWidth * 0.55) px rows", () => {
    installFakeResizeObserver();
    measured1528PxGivesTheClampValue();
  });

  it("C2 a narrow view canvas clamps its rows to 64 px", () => {
    installFakeResizeObserver();
    narrowWidthClampsTo64();
  });

  it("C3 a wide view canvas clamps its rows to 72 px", () => {
    installFakeResizeObserver();
    wideWidthClampsTo72();
  });

  it("C4 the arranging (builder) canvas keeps 72 px rows at any width", () => {
    installFakeResizeObserver();
    arrangingCanvasStays72();
  });

  it("C5 with no ResizeObserver a view canvas keeps 72 px rows", () => {
    removeResizeObserver();
    noResizeObserverGives72();
  });
});
