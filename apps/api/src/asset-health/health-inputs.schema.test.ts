import { describe, it } from "vitest";

import { anythingElseIsRefused, theTwoScopeKeysParseLowerCased } from "./health-inputs.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — the bad-actors query (ADR 0050 Amendment 5)", () => {
  it("organizationId and locationId parse, lower-cased; neither is required", () => theTwoScopeKeysParseLowerCased());
  it("a non-UUID, assetGroupId, windowMinutes and an unknown key are refused", () => anythingElseIsRefused());
});
