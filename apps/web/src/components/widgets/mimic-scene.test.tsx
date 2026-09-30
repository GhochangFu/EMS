// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aShapeCarryingATransformRendersItVerbatim,
  aTransformedShapeKeepsTheGlyphStrokeWidth,
  anInheritedPropertyNameFallsBackToUnit,
  anOrgKeyWithNoMatchDrawsTheFallback,
  anUnknownKeyFallsBackToUnitAndDoesNotThrow,
  aUnitMatchingAnOrgSymbolReceivesIt,
  anUnmappedGlyphClassFallsBackToFillInkMuted,
  childrenDrawInsideTheSvgLast,
  drawingIsNamedByTheLayout,
  drawsEveryUnitWithItsSymbol,
  drawsPanelLabelAndPipes,
  everyGlyphNamesNoColour,
  everyLibraryKeyDrawsAGlyphWithNoFallback,
  everyLibraryShapeUsesWhitelistedTagsAndAttrs,
  everyPanelGlyphClassDrawsItsFillRole,
  everySymbolDrawsAGlyph,
  everyVendoredTransformIsOneMatrix,
  fillShapeIsNotSpread,
  fillLibraryGlyphHasNoStrokeAndTheFillClass,
  matrixScaleReadsTheLinearPart,
  noTwoSymbolsDrawTheSameMarkup,
  passiveUnitDrawsNoStatus,
  resolvedUnitShowsItsAsset,
  roledUnitWithoutEntryIsNotAssigned,
  strokeLibraryGlyphHasNoFillAndNoShapeColour,
  strokeShapeIsNotSpread,
  transformedStrokeShapeIsNotSpread,
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
  it("S10 no two symbols draw the same markup", () => {
    noTwoSymbolsDrawTheSameMarkup();
  });
  it("S11 every glyph names no colour", () => {
    everyGlyphNamesNoColour();
  });
  it("S12 every library key draws a glyph with no fallback", () => {
    everyLibraryKeyDrawsAGlyphWithNoFallback();
  });
  it("S13 an unknown key falls back to unit and does not throw", () => {
    anUnknownKeyFallsBackToUnitAndDoesNotThrow();
  });
  it("S13b a key naming an inherited property draws the unit fallback", () => {
    anInheritedPropertyNameFallsBackToUnit();
  });
  it("S14 a stroke library glyph has no fill and no shape colour", () => {
    strokeLibraryGlyphHasNoFillAndNoShapeColour();
  });
  it("S15 a fill library glyph has no stroke and the fill class", () => {
    fillLibraryGlyphHasNoStrokeAndTheFillClass();
  });
  it("S16a every panel glyph class draws its fill role", () => {
    everyPanelGlyphClassDrawsItsFillRole();
  });
  it("S16b an unmapped glyph class falls back to fill-ink-muted", () => {
    anUnmappedGlyphClassFallsBackToFillInkMuted();
  });
  it("S17 every library shape uses whitelisted tags and attrs", () => {
    everyLibraryShapeUsesWhitelistedTagsAndAttrs();
  });
  it("S18 a shape carrying a transform renders it verbatim", () => {
    aShapeCarryingATransformRendersItVerbatim();
  });
  it("S20a every vendored transform is one matrix", () => {
    everyVendoredTransformIsOneMatrix();
  });
  it("S20b matrixScale reads the linear part", () => {
    matrixScaleReadsTheLinearPart();
  });
  it("S20c a transformed shape keeps the glyph stroke width", () => {
    aTransformedShapeKeepsTheGlyphStrokeWidth();
  });
  it("S21a a stroke shape object is never spread into props", () => {
    strokeShapeIsNotSpread();
  });
  it("S21b a transformed stroke shape object is never spread into props", () => {
    transformedStrokeShapeIsNotSpread();
  });
  it("S21c a fill shape object is never spread into props", () => {
    fillShapeIsNotSpread();
  });
  it("S22 a unit matching an orgSymbols entry hands it to its glyph, passive and roled (F3.32f slice 3)", () => {
    aUnitMatchingAnOrgSymbolReceivesIt();
  });
  it("S23 an org key with no embedded symbol draws the fallback and does not throw (F3.32f slice 3)", () => {
    anOrgKeyWithNoMatchDrawsTheFallback();
  });
});
