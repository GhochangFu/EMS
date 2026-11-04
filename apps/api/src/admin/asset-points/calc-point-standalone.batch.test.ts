import { describe, it } from "vitest";

import {
  aMissingAndAnOutOfScopeAssetShareOneReason,
  neitherRefusalCarriesACode,
} from "./calc-point-standalone.batch.spec";

/** `F4.311` PR 2 review — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — the batch never reveals whether an asset id exists", () => {
  it("gives a missing id and an out-of-scope asset the same reason", () => aMissingAndAnOutOfScopeAssetShareOneReason());
  it("echoes no asset code for either", () => neitherRefusalCarriesACode());
});
