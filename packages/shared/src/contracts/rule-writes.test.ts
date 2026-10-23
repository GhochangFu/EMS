import { describe, it } from "vitest";

import {
  theCodeIsTrimmedAndUpperCased,
  theCreateModelBodyAcceptsAnAsset,
  theCreateModelBodyRefusesNoAsset,
  theDraftBodyAcceptsNoAsset,
  theToggleBodyAcceptsEnabled,
  theToggleBodyRefusesActive,
  theUpdateBodyAcceptsAKnownKeyAlone,
  theUpdateBodyRefusesAnUnknownKey,
} from "./rule-writes.spec";

/** `F4.278` — Vitest entry point for the alarm-rule request bodies. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — alarm-rule request bodies", () => {
  it("the update body refuses an unknown key", () => {
    theUpdateBodyRefusesAnUnknownKey();
  });

  it("the update body accepts a known key alone", () => {
    theUpdateBodyAcceptsAKnownKeyAlone();
  });

  it("the toggle body accepts enabled", () => {
    theToggleBodyAcceptsEnabled();
  });

  it("the toggle body refuses active", () => {
    theToggleBodyRefusesActive();
  });

  it("the copilot create model body refuses a draft without an asset", () => {
    theCreateModelBodyRefusesNoAsset();
  });

  it("the copilot create model body accepts a draft with an asset", () => {
    theCreateModelBodyAcceptsAnAsset();
  });

  it("the route's draft body accepts an asset-less draft", () => {
    theDraftBodyAcceptsNoAsset();
  });

  it("the code is trimmed and upper-cased", () => {
    theCodeIsTrimmedAndUpperCased();
  });
});
