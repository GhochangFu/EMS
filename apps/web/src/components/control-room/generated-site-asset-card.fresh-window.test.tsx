// @vitest-environment jsdom
import { describe, it } from "vitest";

import {
  aFastDeviceIsStaleAtFiftyFiveSeconds,
  aSixtySecondDeviceIsLiveAtFiftyFiveSeconds,
  noWindowKeepsTheFloor,
} from "./generated-site-asset-card.fresh-window.spec";

/** `F4.350` — the asset card follows the asset's own window (ADR 0075 Amendment 3). */
describe("F4.350 — GeneratedSiteAssetCard follows the asset's window", () => {
  it("a 60 s device is Live at 55 s", () => {
    aSixtySecondDeviceIsLiveAtFiftyFiveSeconds();
  });
  it("no window from the API keeps the 25 s floor", () => {
    noWindowKeepsTheFloor();
  });
  it("a fast device is Stale at 55 s", () => {
    aFastDeviceIsStaleAtFiftyFiveSeconds();
  });
});
