// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  childrenDrawInsideTheSvgLast,
  drawingIsNamedByTheLayout,
  drawsEveryUnitWithItsSymbol,
  drawsPanelLabelAndPipes,
  everySymbolDrawsAGlyph,
  passiveUnitDrawsNoStatus,
  resolvedUnitShowsItsAsset,
  roledUnitWithoutEntryIsNotAssigned,
  unitsDrawAtTheirScale,
} from "./mimic-scene.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32c U4 — MimicScene, a stored layout", () => {
  afterEach(() => {
    cleanup();
  });

  it("S1 draws every unit with its symbol; the panel groups the units it holds", () => {
    drawsEveryUnitWithItsSymbol();
  });
  it("S2 a passive unit draws its symbol with no status and no values", () => {
    passiveUnitDrawsNoStatus();
  });
  it("S3 a roled unit with no resolved entry says Not assigned", () => {
    roledUnitWithoutEntryIsNotAssigned();
  });
  it("S4 a resolved roled unit shows its asset, value and flow", () => {
    resolvedUnitShowsItsAsset();
  });
  it("S5 draws the panel frame, the free label and the pipes; no pump, no sink", () => {
    drawsPanelLabelAndPipes();
  });
  it("S6 each unit draws at its box's scale, centred", () => {
    unitsDrawAtTheirScale();
  });
  it("S7 the drawing is named by the title and the layout's name", () => {
    drawingIsNamedByTheLayout();
  });
  it("S8 children draw inside the svg, last", () => {
    childrenDrawInsideTheSvgLast();
  });
  it("S9 every shared symbol draws a non-empty glyph", () => {
    everySymbolDrawsAGlyph();
  });
});
