// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  carriesNoRoleColourClass,
  drawsAnInlineSvgWithNoText,
  drawsTheDarkFormByDefault,
  drawsTheLightFormOnRequest,
  fillsTheLettersEvenOdd,
  fillsThePulseWithOneGradient,
  givesEachLogoItsOwnGradientId,
  namesTheHeaderLogoVerve,
  sizesTheHeroAndTheHeader,
} from "./wordmark.spec";

/**
 * `F4.398` U2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(cleanup);

describe("F4.398 the Verve logo", () => {
  it("W1 names the header logo Verve as an image", () => {
    namesTheHeaderLogoVerve();
  });

  it("W2 draws an inline svg with the asset view box, no text and no img", () => {
    drawsAnInlineSvgWithNoText();
  });

  it("W3 fills the pulse with one gradient and no stroke", () => {
    fillsThePulseWithOneGradient();
  });

  it("W4 draws the dark form by default", () => {
    drawsTheDarkFormByDefault();
  });

  it("W5 draws the light form on request", () => {
    drawsTheLightFormOnRequest();
  });

  it("W6 gives each logo its own gradient id", () => {
    givesEachLogoItsOwnGradientId();
  });

  it("W7 sizes the hero and the header", () => {
    sizesTheHeroAndTheHeader();
  });

  it("W8 fills the letters by the even-odd rule", () => {
    fillsTheLettersEvenOdd();
  });

  it("W9 carries no role colour class", () => {
    carriesNoRoleColourClass();
  });
});
