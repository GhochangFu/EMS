import { describe, it } from "vitest";

import {
  baseZoomFollowsTheWidth,
  everyFallsBackToTheDefault,
  fitZoomFloorsToTwoDecimals,
  fitZoomNeverExceedsTheBase,
  fitZoomStopsAtTheFloor,
  fitZoomWithoutAMeasurementKeepsTheBase,
  newestReadClampsAFutureTime,
  newestReadIgnoresWhatIsNoEvidence,
  newestReadIsTheMaximum,
  nextTabKeyWrapsAndSkipsNothing,
  noReadIsPausedWithNoTime,
  settleAlwaysAppliesAShrink,
  settleAppliesALargeGrowth,
  settleIgnoresASmallGrowth,
  theAspectCapIsSixtyPercentOfTheScreen,
  theAspectCapWithoutAMeasurementIsNull,
  wallBarClampsAReadAheadOfTheClock,
  wallBarFollowsIsStale,
  wallHrefKeepsTheTabInThePath,
  wallIsOnOnlyForOne,
  wallTimeIsPaddedLocalTime,
} from "./wall-mode.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.77 wall mode — the pure rules (plan D7)", () => {
  it("W1 turns wall mode on only for wall=1", () => {
    wallIsOnOnlyForOne();
  });

  it("W2 reads every as one of 15/30/60/120, else 30", () => {
    everyFallsBackToTheDefault();
  });

  it("W3 keeps the tab in the path segment of the wall URL", () => {
    wallHrefKeepsTheTabInThePath();
  });

  it("W4 rotates to the next tab, wraps and skips nothing", () => {
    nextTabKeyWrapsAndSkipsNothing();
  });

  it("W5 takes the newest of the samples, the catalog read and the site-widgets read", () => {
    newestReadIsTheMaximum();
  });

  it("W6 ignores no read, a never-updated query and an unparsable time", () => {
    newestReadIgnoresWhatIsNoEvidence();
  });

  it("W7 is live at FRESH_MS old and paused one ms later", () => {
    wallBarFollowsIsStale();
  });

  it("W8 is paused with no time when nothing has been read", () => {
    noReadIsPausedWithNoTime();
  });

  it("W9 formats a time as zero-padded 24-hour hh:mm:ss", () => {
    wallTimeIsPaddedLocalTime();
  });

  it("W10 clamps a sample or a catalog read ahead of the clock to now, so the bar stays live", () => {
    newestReadClampsAFutureTime();
  });

  it("W11 keeps the bar live for a read a moment ahead of the frame's tick", () => {
    wallBarClampsAReadAheadOfTheClock();
  });
});

describe("F3.77 follow-up wall mode — the fit zoom (plan D5)", () => {
  it("Z1 bases the zoom at 1.25, and 2.5 from 3000 px wide", () => {
    baseZoomFollowsTheWidth();
  });

  it("Z2 zooms tall content to fit, floored to two decimals", () => {
    fitZoomFloorsToTwoDecimals();
  });

  it("Z3 keeps the base for content that fits", () => {
    fitZoomNeverExceedsTheBase();
  });

  it("Z4a stops at the 0.5 floor", () => {
    fitZoomStopsAtTheFloor();
  });

  it("Z4b keeps the base without a measurement (zero, negative, NaN)", () => {
    fitZoomWithoutAMeasurementKeepsTheBase();
  });

  it("Z5a ignores a growth under 0.05", () => {
    settleIgnoresASmallGrowth();
  });

  it("Z5b applies a growth of 0.05 or more", () => {
    settleAppliesALargeGrowth();
  });

  it("Z5c always applies a shrink", () => {
    settleAlwaysAppliesAShrink();
  });

  it("Z6a caps a fixed-aspect tile at 60 % of the screen, in the zoomed box's px", () => {
    theAspectCapIsSixtyPercentOfTheScreen();
  });

  it("Z6b gives no cap without a measurement", () => {
    theAspectCapWithoutAMeasurementIsNull();
  });
});
