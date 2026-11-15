import { describe, it } from "vitest";

import {
  runANonUniformRowIsLeftAsStored,
  runNothingHiddenIsTheSameArray,
  runTheGapClosesInAUniformRow,
  runTheGapNeverCreatesAnOverlap,
  runTheKwOnlyPredicate,
  runTheStripTileKeys,
} from "./energy-widgets.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.375 — kW-only widgets and the gap they leave (ADR 0133 Amendment 2 ruling 2)", () => {
  it("W1 — kw exactly, every binding, never an empty binding list", () => {
    runTheKwOnlyPredicate();
  });

  it("W2 — a strip tile's keys are its sources' pointKeys", () => {
    runTheStripTileKeys();
  });

  it("W3 — the gap closes inside a uniform row", () => {
    runTheGapClosesInAUniformRow();
  });

  it("W4 — a non-uniform row is left as stored; other rows are untouched", () => {
    runANonUniformRowIsLeftAsStored();
  });

  it("W6 — the gap rule never moves a tile onto another one", () => {
    runTheGapNeverCreatesAnOverlap();
  });

  it("W5 — nothing hidden returns the same array", () => {
    runNothingHiddenIsTheSameArray();
  });
});
