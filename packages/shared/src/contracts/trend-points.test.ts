import { describe, it } from "vitest";

import {
  acceptsAnEmptyList,
  acceptsTheCapAndRefusesOneMore,
  parsesTwoSourcesOnly,
  refusesABadCode,
  refusesADuplicate,
  refusesAnUnknownKey,
} from "./trend-points.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.300 — trend-point contracts", () => {
  it("P1 caps a segment at 12 codes", () => {
    acceptsTheCapAndRefusesOneMore();
  });

  it("P2 refuses a duplicate code", () => {
    refusesADuplicate();
  });

  it("P3 refuses a code outside the catalog class", () => {
    refusesABadCode();
  });

  it("P4 refuses an unknown key", () => {
    refusesAnUnknownKey();
  });

  it("P5 accepts an empty list", () => {
    acceptsAnEmptyList();
  });

  it("P6 accepts catalog and organization sources only", () => {
    parsesTwoSourcesOnly();
  });
});
