import { describe, it } from "vitest";

import {
  aBatchBodyAcceptsTheFirstAndLastExcludedRow,
  aBatchBodyAcceptsTwentyFiveRows,
  aBatchBodyRefusesAnExcludedRowPastTheBound,
  aBatchBodyRefusesAnUnknownKey,
  aBatchBodyRefusesNoRows,
  aBatchBodyRefusesTwentySixRows,
  theBatchBodyAcceptsAnAssetlessRow,
  theBatchModelBodyAcceptsTheRowsAlone,
  theBatchModelBodyRefusesAnAssetlessRow,
  theBatchModelBodyRefusesExcludedRows,
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

/** `F4.289` (ADR 0099 Amendment 9 E3) — the rule batch body and its copilot model body. */
describe("F4.289 — the rule batch bodies", () => {
  it("refuses no rows", () => {
    aBatchBodyRefusesNoRows();
  });

  it("refuses twenty-six rows", () => {
    aBatchBodyRefusesTwentySixRows();
  });

  it("accepts twenty-five rows", () => {
    aBatchBodyAcceptsTwentyFiveRows();
  });

  it("refuses an excluded row index past the bound", () => {
    aBatchBodyRefusesAnExcludedRowPastTheBound();
  });

  it("accepts the first and the last excluded row index", () => {
    aBatchBodyAcceptsTheFirstAndLastExcludedRow();
  });

  it("refuses an unknown top-level key", () => {
    aBatchBodyRefusesAnUnknownKey();
  });

  it("the model body refuses excludedRows", () => {
    theBatchModelBodyRefusesExcludedRows();
  });

  it("the model body accepts the rows alone", () => {
    theBatchModelBodyAcceptsTheRowsAlone();
  });

  it("the model body refuses an asset-less row", () => {
    theBatchModelBodyRefusesAnAssetlessRow();
  });

  it("the route's batch body accepts an asset-less row", () => {
    theBatchBodyAcceptsAnAssetlessRow();
  });
});
