// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aNewTabClearsTheCeiling,
  aRewrapJumpSettlesBelowTheCeiling,
  aSmallGrowthKeepsTheZoom,
  aWindowResizeClearsTheCeiling,
  aTallerContentShrinksTheZoom,
  aWideScreenKeepsItsBase,
  aWindowResizeRecomputes,
  contentThatFitsKeepsTheBase,
  setUpFit,
  tallContentZoomsToFit,
  tearDownFit,
  unmountDisconnectsTheObserver,
  unmountRemovesTheResizeListener,
} from "./use-wall-fit.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.77 follow-up useWallFit (plan D5)", () => {
  beforeEach(() => {
    setUpFit();
  });

  afterEach(() => {
    tearDownFit();
  });

  it("H1 zooms tall content to fit at the first layout", () => {
    tallContentZoomsToFit();
  });

  it("H2 keeps the 1.25 base for content that fits", () => {
    contentThatFitsKeepsTheBase();
  });

  it("H3 keeps the 2.5 base on a 3000 px screen", () => {
    aWideScreenKeepsItsBase();
  });

  it("H4a keeps the zoom on a growth under the step", () => {
    aSmallGrowthKeepsTheZoom();
  });

  it("H4b shrinks the zoom when the content grows", () => {
    aTallerContentShrinksTheZoom();
  });

  it("H5 recomputes on a window resize", () => {
    aWindowResizeRecomputes();
  });

  it("H7 settles a re-wrap jump bigger than the step below the overflow ceiling", () => {
    aRewrapJumpSettlesBelowTheCeiling();
  });

  it("H8 clears the ceiling on a window resize", () => {
    aWindowResizeClearsTheCeiling();
  });

  it("H9 clears the ceiling on a new tab", () => {
    aNewTabClearsTheCeiling();
  });

  it("H6a disconnects the observer on unmount", () => {
    unmountDisconnectsTheObserver();
  });

  it("H6b removes the resize listener on unmount", () => {
    unmountRemovesTheResizeListener();
  });
});
