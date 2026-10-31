import { describe, it } from "vitest";

import {
  acceptsABodyWithoutARank,
  createBodyTakesABooleanTrendDefault,
  dtoRequiresTrendDefault,
  acceptsANullRank,
  acceptsARankOfTwo,
  refusesAFractionalRank,
  refusesARankAboveSmallint,
  refusesAZeroRank,
  stillRefusesAnUnknownKey,
  updateBodyTakesTrendDefaultAlone,
} from "./point-key-writes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.68 — headlineRank on the point-key admin bodies", () => {
  it("B1 refuses a rank of 0", () => {
    refusesAZeroRank();
  });

  it("B1b refuses a rank above the smallint ceiling", () => {
    refusesARankAboveSmallint();
  });

  it("B1c refuses a fractional rank", () => {
    refusesAFractionalRank();
  });

  it("B2 accepts null, which clears a rank", () => {
    acceptsANullRank();
  });

  it("B3 accepts a rank of 2", () => {
    acceptsARankOfTwo();
  });

  it("B3b accepts a body without a rank", () => {
    acceptsABodyWithoutARank();
  });

  it("B4 still refuses an unknown key", () => {
    stillRefusesAnUnknownKey();
  });
});

describe("F4.300 — trendDefault on the point-key bodies and DTO", () => {
  it("T1 the create body takes a boolean and refuses a string", () => {
    createBodyTakesABooleanTrendDefault();
  });

  it("T2 the update body takes trendDefault alone", () => {
    updateBodyTakesTrendDefaultAlone();
  });

  it("T3 the admin DTO requires trendDefault", () => {
    dtoRequiresTrendDefault();
  });
});
