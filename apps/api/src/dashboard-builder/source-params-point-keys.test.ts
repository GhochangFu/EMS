import { describe, it } from "vitest";

import {
  oldEntriesYieldNothing,
  pointKeysAreDeduplicated,
  sustainabilitySourceYieldsItsPointKey,
  unknownCatalogKeyYieldsNothing,
  unparseableParamsYieldNothing,
} from "./source-params-point-keys.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.2 U3 — sourceParamsPointKeys", () => {
  it("yields nothing for the five Stage C entries", () => {
    oldEntriesYieldNothing();
  });

  it("yields a sustainability binding's pointKey", () => {
    sustainabilitySourceYieldsItsPointKey();
  });

  it("yields nothing for params the write schema refuses", () => {
    unparseableParamsYieldNothing();
  });

  it("de-duplicates a key bound on more than one widget", () => {
    pointKeysAreDeduplicated();
  });

  it("yields nothing for a catalog key outside the vocabulary, without throwing", () => {
    unknownCatalogKeyYieldsNothing();
  });
});
