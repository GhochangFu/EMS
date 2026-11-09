// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  aFillOrgSymbolDrawsWithTheFillClass,
  aMovingGlyphWrapsItsContentInAnUnpositionedInnerG,
  aStillGlyphGetsNoWrapper,
  everyDrawPathWrapsItsContent,
  anExtraStoredKeyNeverReachesTheDom,
  anOrgKindWithNoSymbolDrawsTheFallback,
  anOrgSymbolDrawsOneElementPerShape,
  anOrgSymbolIsScaledAndCentredByItsViewBox,
  aVendoredKeyStillDraws,
  noCreateElementCallSpreadsAStoredObject,
} from "./mimic-glyphs.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.32f slice 3 — MimicGlyph draws an organization symbol", () => {
  afterEach(() => {
    cleanup();
  });

  it("G1 draws one element per shape, marked data-glyph-source=org", () => {
    anOrgSymbolDrawsOneElementPerShape();
  });
  it("G2 scales the longer viewBox side to size, centres the shorter, scales the stroke", () => {
    anOrgSymbolIsScaledAndCentredByItsViewBox();
  });
  it("G3 a fill symbol has no stroke and the mapped fill class", () => {
    aFillOrgSymbolDrawsWithTheFillClass();
  });
  it("G4 an extra key on a stored attrs object never reaches the DOM", () => {
    anExtraStoredKeyNeverReachesTheDom();
  });
  it("G5 an org kind with no symbol draws the fallback and does not throw", () => {
    anOrgKindWithNoSymbolDrawsTheFallback();
  });
  it("G6 a vendored key still draws with no fallback", () => {
    aVendoredKeyStillDraws();
  });
  it("G7 no createElement call spreads an object", () => {
    noCreateElementCallSpreadsAStoredObject();
  });
  it("GM1 a moving glyph wraps its content in an unpositioned inner g carrying the motion (F4.344)", () => {
    aMovingGlyphWrapsItsContentInAnUnpositionedInnerG();
  });
  it("GM2 a still glyph gets no wrapper (F4.344)", () => {
    aStillGlyphGetsNoWrapper();
  });
  it("GM3 every draw path wraps its content: stroke, fill, org, fallback (F4.344)", () => {
    everyDrawPathWrapsItsContent();
  });
});
