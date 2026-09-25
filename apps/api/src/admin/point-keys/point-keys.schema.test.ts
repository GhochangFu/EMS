import { describe, it } from "vitest";

import {
  acceptsABodyWithoutARank,
  acceptsANullRank,
  acceptsARankOfTwo,
  refusesAFractionalRank,
  refusesARankAboveSmallint,
  refusesAZeroRank,
  registryAndLedgerStillNameTheBodies,
  stillRefusesAnUnknownKey,
} from "./point-keys.schema.spec";

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

  it("keeps both bodies in the OpenAPI registry and the strict-body ledger", () => {
    registryAndLedgerStillNameTheBodies();
  });
});
