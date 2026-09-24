import { describe, it } from "vitest";

import {
  assertAbsentStateDefaultsToAll,
  assertActiveStateParses,
  assertAnUnknownKeyIsRefused,
  assertAssetIdsIsCappedAtTheSharedMaximum,
  assertEmptyLimitIsAbsent,
  assertInfiniteLimitParsesForTheServiceClamp,
  assertNegativeLimitParsesForTheServiceClamp,
  assertNonNumericLimitIsRefused,
  assertOverCapFractionalLimitParses,
  assertSubOneFractionalLimitParses,
  assertSummaryQueryAcceptsAnEmptyQuery,
  assertSummaryQueryAcceptsAssetIdsAlone,
  assertSummaryQueryRefusesAnUnknownKey,
  assertUnknownStateValueIsRefused,
  assertZeroLimitParsesForTheServiceClamp,
} from "./alarm-list.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 — alarmListQuerySchema (ADR 0074, plan decisions 1 and 4)", () => {
  it("defaults state to 'all' when absent", () => {
    assertAbsentStateDefaultsToAll();
  });

  it("refuses state=open — not a live value", () => {
    assertUnknownStateValueIsRefused();
  });

  it("accepts state=active", () => {
    assertActiveStateParses();
  });

  it("refuses an unknown query key", () => {
    assertAnUnknownKeyIsRefused();
  });

  it("caps assetIds at the shared maximum", () => {
    assertAssetIdsIsCappedAtTheSharedMaximum();
  });

  it("parses limit=0 for the service clamp", () => {
    assertZeroLimitParsesForTheServiceClamp();
  });

  it("parses a negative limit for the service clamp", () => {
    assertNegativeLimitParsesForTheServiceClamp();
  });

  it("reads an empty limit= as absent", () => {
    assertEmptyLimitIsAbsent();
  });

  it("parses limit=Infinity for the service clamp", () => {
    assertInfiniteLimitParsesForTheServiceClamp();
  });

  it("parses limit=0.5 for the service clamp", () => {
    assertSubOneFractionalLimitParses();
  });

  it("parses limit=150.5 for the service clamp", () => {
    assertOverCapFractionalLimitParses();
  });

  it("refuses a non-numeric limit", () => {
    assertNonNumericLimitIsRefused();
  });
});

describe("F3.28 — alarmSummaryQuerySchema", () => {
  it("accepts assetIds alone", () => {
    assertSummaryQueryAcceptsAssetIdsAlone();
  });

  it("accepts an empty query", () => {
    assertSummaryQueryAcceptsAnEmptyQuery();
  });

  it("refuses an unknown key", () => {
    assertSummaryQueryRefusesAnUnknownKey();
  });
});
