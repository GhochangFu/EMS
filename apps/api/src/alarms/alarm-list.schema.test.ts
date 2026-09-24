import { describe, it } from "vitest";

import {
  assertAbsentStateDefaultsToAll,
  assertActiveStateParses,
  assertAnUnknownKeyIsRefused,
  assertAssetIdsIsCappedAtTheSharedMaximum,
  assertSummaryQueryAcceptsAssetIdsAndRefusesUnknownKeys,
  assertUnknownStateValueIsRefused,
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
});

describe("F3.28 — alarmSummaryQuerySchema", () => {
  it("accepts assetIds alone, an empty query, and refuses an unknown key", () => {
    assertSummaryQueryAcceptsAssetIdsAndRefusesUnknownKeys();
  });
});
