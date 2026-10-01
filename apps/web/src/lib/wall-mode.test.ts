import { describe, it } from "vitest";

import {
  everyFallsBackToTheDefault,
  newestReadIgnoresWhatIsNoEvidence,
  newestReadIsTheMaximum,
  nextTabKeyWrapsAndSkipsNothing,
  noReadIsPausedWithNoTime,
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
});
