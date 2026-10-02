// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aResizeMovesTheCapAtTheSameZoom,
  theClockTickDoesNotRerenderTheCanvas,
  theFrameProvidesTheAspectCap,
  aFreshReadShowsUpdated,
  aStaleReadShowsPaused,
  exitWallLinksToTheBareTabPath,
  noReadShowsPausedWithNoTime,
  resumeShowsOnlyWhilePaused,
  setUpFrame,
  tabReachesResumeAndTheTabs,
  tearDownFrame,
  theClockShowsSeconds,
  theFrameHasNoShellLandmarks,
  theRootZoomIsTheComputedFit,
  theScreenHeightIsOutsideTheZoom,
  theSelectChangesEvery,
} from "./wall-frame.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.77 WallFrame (plan D8, D9)", () => {
  beforeEach(() => {
    setUpFrame();
  });

  afterEach(() => {
    tearDownFrame();
  });

  it("F1 renders no app-shell landmark and the site name as h1", () => {
    theFrameHasNoShellLandmarks();
  });

  it("F2 shows a clock with seconds that moves each second", () => {
    theClockShowsSeconds();
  });

  it("F3 shows Updated hh:mm:ss for a fresh reported read", () => {
    aFreshReadShowsUpdated();
  });

  it("F4 shows Live data paused since hh:mm:ss once the read is past FRESH_MS", () => {
    aStaleReadShowsPaused();
  });

  it("F5 shows Live data paused with no time when nothing was read", () => {
    noReadShowsPausedWithNoTime();
  });

  it("F6 rewrites every in the URL from the interval select", () => {
    theSelectChangesEvery();
  });

  it("F7 links Exit wall to the bare tab path", () => {
    exitWallLinksToTheBareTabPath();
  });

  it("F8 shows Resume only while paused and resumes on a click", () => {
    resumeShowsOnlyWhilePaused();
  });

  it("F9 lets the keyboard reach the Resume control and the tabs", async () => {
    await tabReachesResumeAndTheTabs();
  });

  it("F10a zooms the wall root to the computed fit of the bar and the content", () => {
    theRootZoomIsTheComputedFit();
  });

  it("F10b keeps min-h-screen on an unzoomed outer element", () => {
    theScreenHeightIsOutsideTheZoom();
  });

  it("F11a gives the canvas a fixed-aspect cap of 60 % of the screen, in the zoomed box's px", () => {
    theFrameProvidesTheAspectCap();
  });

  it("F11b moves the cap on a window resize that leaves the zoom alone", () => {
    aResizeMovesTheCapAtTheSameZoom();
  });

  it("F11c does not re-render the canvas on the bar's clock tick", () => {
    theClockTickDoesNotRerenderTheCanvas();
  });
});
