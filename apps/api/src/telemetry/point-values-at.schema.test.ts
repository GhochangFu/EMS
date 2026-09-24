import { describe, it } from "vitest";

import {
  assertAnOrdinaryPastAtParses,
  assertAnUnknownKeyIsRefused,
  assertAtBeforeTheEpochIsRefused,
  assertAtFarInTheFutureIsRefused,
  assertAtInYearZeroIsRefused,
  assertAtWithoutOffsetIsRefused,
  assertFiftyOneRefsAreRefused,
  assertFiftyRefsParse,
  assertMissingAtIsRefused,
  assertOneRefParses,
  assertTwentyOneRefsParse,
} from "./point-values-at.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 — pointValuesAtQuerySchema (ADR 0074 decision 2)", () => {
  it("parses a single ref", () => {
    assertOneRefParses();
  });

  it("parses 21 refs — one past qs's arrayLimit — in order", () => {
    assertTwentyOneRefsParse();
  });

  it("parses exactly the cap (50 refs)", () => {
    assertFiftyRefsParse();
  });

  it("refuses one past the cap (51 refs)", () => {
    assertFiftyOneRefsAreRefused();
  });

  it("refuses an `at` with no offset", () => {
    assertAtWithoutOffsetIsRefused();
  });

  it("refuses an unknown query key", () => {
    assertAnUnknownKeyIsRefused();
  });

  it("refuses a missing `at`", () => {
    assertMissingAtIsRefused();
  });

  it("refuses an `at` in year 0", () => {
    assertAtInYearZeroIsRefused();
  });

  it("refuses an `at` before 1970", () => {
    assertAtBeforeTheEpochIsRefused();
  });

  it("refuses an `at` more than a day in the future", () => {
    assertAtFarInTheFutureIsRefused();
  });

  it("parses an ordinary past `at` and the epoch itself", () => {
    assertAnOrdinaryPastAtParses();
  });
});
