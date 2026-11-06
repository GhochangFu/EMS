import { describe, it } from "vitest";

import {
  aMovedOrResizedWidgetChangesIt,
  aRemovedOrAddedWidgetChangesIt,
  aRenamedRegroupedOrReorderedTabChangesIt,
  aReboundPointOrSourceChangesIt,
  aRetitledOrReconfiguredWidgetChangesIt,
  theFingerprintIgnoresRowOrderAndKeyOrder,
} from "./site-layout-seed-move.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.319 plan D5 — the copy fingerprint reads 'untouched' from content", () => {
  it("ignores row order and JSON key order", () => {
    theFingerprintIgnoresRowOrderAndKeyOrder();
  });
  it("changes when a widget moves or is resized", () => {
    aMovedOrResizedWidgetChangesIt();
  });
  it("changes when a widget is retitled or reconfigured", () => {
    aRetitledOrReconfiguredWidgetChangesIt();
  });
  it("changes when a widget is removed or added", () => {
    aRemovedOrAddedWidgetChangesIt();
  });
  it("changes when a point or a source is re-bound", () => {
    aReboundPointOrSourceChangesIt();
  });
  it("changes when a tab is renamed, regrouped or reordered", () => {
    aRenamedRegroupedOrReorderedTabChangesIt();
  });
});
