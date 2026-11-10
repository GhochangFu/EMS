// @vitest-environment jsdom
import { describe, it } from "vitest";

import { aFailedReadKeepsTheFloor, anEmptyListAsksNothing, windowsArriveInMilliseconds } from "./use-asset-windows.spec";

/** `F4.350` — `useAssetWindows` (ADR 0075 Amendment 3). */
describe("F4.350 — useAssetWindows", () => {
  it("returns the windows in milliseconds and leaves an unanswered asset out", async () => {
    await windowsArriveInMilliseconds();
  });
  it("asks nothing for an empty list", async () => {
    await anEmptyListAsksNothing();
  });
  it("keeps the floor when the read fails", async () => {
    await aFailedReadKeepsTheFloor();
  });
});
