import { describe, it } from "vitest";

import { aGroupAnUnknownKeyOrANonUuidIsRefused, theTwoScopeKeysParseAndAreLowerCased } from "./degradation.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — degradationQuerySchema (ADR 0138)", () => {
  it("organizationId and locationId parse, each optional and lower-cased", () => theTwoScopeKeysParseAndAreLowerCased());
  it("assetGroupId, any unknown key and a non-UUID are refused (.strict())", () => aGroupAnUnknownKeyOrANonUuidIsRefused());
});
