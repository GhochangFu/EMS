import { describe, it } from "vitest";

import {
  aMalformedTabKeyIsRefused,
  anUnknownConfigKeyIsRefused,
  compactOnTheLayoutArmIsRefused,
  theLayoutArmKeepsTabKey,
  thePresetArmKeepsCompact,
  thePresetArmKeepsTabKey,
} from "./dashboards.schema.mimic-tab.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.74 — a mimic config names a tab and may be compact", () => {
  it("the preset arm keeps tabKey", () => {
    thePresetArmKeepsTabKey();
  });

  it("the layout arm keeps tabKey", () => {
    theLayoutArmKeepsTabKey();
  });

  it("the preset arm keeps compact", () => {
    thePresetArmKeepsCompact();
  });

  it("a malformed tabKey is refused at the field", () => {
    aMalformedTabKeyIsRefused();
  });

  it("an unknown config key is refused", () => {
    anUnknownConfigKeyIsRefused();
  });

  it("compact on the layout arm is refused", () => {
    compactOnTheLayoutArmIsRefused();
  });
});
