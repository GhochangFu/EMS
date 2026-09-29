import { describe, it } from "vitest";

import {
  assertAControlCharacterInAKeyIsRefused,
  assertAKeyLongerThanTheColumnIsRefused,
  assertANonUuidIdIsRefused,
  assertAnAbsentWindowDefaultsToFifteen,
  assertAnOutOfRangeWindowIsRefused,
  assertAnUnknownKeyIsRefused,
  assertFiftyIdsParse,
  assertFiftyOneIdsAreRefused,
  assertNoIdIsRefused,
  assertNoKeyIsRefused,
  assertOneIdAndOneKeyParse,
  assertSixtyFiveKeysAreRefused,
  assertSixtyFourKeysParse,
  assertTheWindowBoundsParse,
  assertTwentyOneIdsParseInOrder,
} from "./points-latest.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.176 — pointsLatestQuerySchema (ADR 0074 Amendment 2)", () => {
  it("parses one id and one key", () => {
    assertOneIdAndOneKeyParse();
  });

  it("parses 21 ids — one past qs's arrayLimit — in order", () => {
    assertTwentyOneIdsParseInOrder();
  });

  it("parses exactly the id cap (50)", () => {
    assertFiftyIdsParse();
  });

  it("refuses one past the id cap (51)", () => {
    assertFiftyOneIdsAreRefused();
  });

  it("refuses a query with no asset id", () => {
    assertNoIdIsRefused();
  });

  it("refuses a non-UUID asset id", () => {
    assertANonUuidIdIsRefused();
  });

  it("parses exactly the key cap (64)", () => {
    assertSixtyFourKeysParse();
  });

  it("refuses one past the key cap (65)", () => {
    assertSixtyFiveKeysAreRefused();
  });

  it("refuses a query with no point key", () => {
    assertNoKeyIsRefused();
  });

  it("refuses a point key longer than the column", () => {
    assertAKeyLongerThanTheColumnIsRefused();
  });

  it("refuses a control character in a point key", () => {
    assertAControlCharacterInAKeyIsRefused();
  });

  it("defaults an absent window to 15 minutes", () => {
    assertAnAbsentWindowDefaultsToFifteen();
  });

  it("parses both window bounds (1 and 60)", () => {
    assertTheWindowBoundsParse();
  });

  it("refuses a window of 0, 61, a fraction or text", () => {
    assertAnOutOfRangeWindowIsRefused();
  });

  it("refuses an unknown query key", () => {
    assertAnUnknownKeyIsRefused();
  });
});
