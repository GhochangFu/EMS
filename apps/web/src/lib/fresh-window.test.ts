import { describe, it } from "vitest";

import {
  assetStatusFollowsTheWindow,
  freshWindowMsIsTheWindowOrTheFloor,
  isStaleTakesTheAssetsWindow,
  mimicNodeUsesTheAssetsWindow,
  wallBarUsesTheWindow,
  widgetTileAgesOnTheAssetsWindow,
  windowsAreRequestedFiftyAtATime,
} from "./fresh-window.spec";

/** `F4.350` — the web judges each asset on its own window (ADR 0075 Amendment 3). */
describe("F4.350 — the web's freshness follows the asset's window", () => {
  it("W1 freshWindowMs is the window or the floor", () => {
    freshWindowMsIsTheWindowOrTheFloor();
  });
  it("W2 isStale takes the asset's window", () => {
    isStaleTakesTheAssetsWindow();
  });
  it("W3 assetStatus follows the window", () => {
    assetStatusFollowsTheWindow();
  });
  it("W4 the wall bar uses the window", () => {
    wallBarUsesTheWindow();
  });
  it("W5 a widget tile ages on its asset's window", () => {
    widgetTileAgesOnTheAssetsWindow();
  });
  it("W6 a mimic node uses its asset's window", () => {
    mimicNodeUsesTheAssetsWindow();
  });
  it("W7 windows are requested fifty at a time", () => {
    windowsAreRequestedFiftyAtATime();
  });
});
