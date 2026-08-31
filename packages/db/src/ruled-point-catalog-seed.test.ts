import { describe, it } from "vitest";

import {
  assertBothStatementsSelectTheSameRules,
  assertPointsAreUnmappedWithNoGateway,
  assertReSeedingIsIdempotentAndNeverOverwrites,
  assertTheInsertCannotReachAnotherOrganization,
} from "./ruled-point-catalog-seed.spec";

describe("F4.69 — a catalog row for every ruled point", () => {
  it("selects the same rules in the insert and in its post-condition", () => {
    assertBothStatementsSelectTheSameRules();
  });

  it("writes an unmapped point with no gateway, which the CHECK admits", () => {
    assertPointsAreUnmappedWithNoGateway();
  });

  it("is idempotent on a re-seed and never overwrites an edited row", () => {
    assertReSeedingIsIdempotentAndNeverOverwrites();
  });

  it("cannot reach another organization's rules", () => {
    assertTheInsertCannotReachAnotherOrganization();
  });
});
