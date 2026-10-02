// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  aKeydownPausesTheRotation,
  aPointerdownInTheBarDoesNotPause,
  aPointerdownOnThePagePauses,
  itAdvancesAfterEveryWithReplace,
  oneTabNeverRotates,
  resumeRestartsTheRotation,
  setUpRotation,
  tearDownRotation,
  theBarePathAdvancesToTheSecondTab,
  unmountClearsTheTimerAndTheListeners,
} from "./use-wall-rotation.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.77 useWallRotation (plan D8)", () => {
  beforeEach(() => {
    setUpRotation();
  });

  afterEach(() => {
    tearDownRotation();
  });

  it("R1 replaces the URL with the next tab after every seconds, not before", () => {
    itAdvancesAfterEveryWithReplace();
  });

  it("R2 pauses on a keydown anywhere on the document", () => {
    aKeydownPausesTheRotation();
  });

  it("R3a pauses on a pointerdown on the page", () => {
    aPointerdownOnThePagePauses();
  });

  it("R3b does not pause on a pointerdown or a key inside the wall bar", () => {
    aPointerdownInTheBarDoesNotPause();
  });

  it("R4 restarts the rotation on resume()", () => {
    resumeRestartsTheRotation();
  });

  it("R5 advances from the bare path to the second tab", () => {
    theBarePathAdvancesToTheSecondTab();
  });

  it("R6 never rotates a single tab", () => {
    oneTabNeverRotates();
  });

  it("R7 clears the timer and the listeners on unmount", () => {
    unmountClearsTheTimerAndTheListeners();
  });
});
