import { describe, it } from "vitest";

import { aGroupAnAssetAnUnknownKeyOrANonUuidIsRefused, theTwoScopeKeysParseAndAreLowerCased } from "./advisories.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — advisoriesQuerySchema (ADR 0137)", () => {
  it("organizationId and locationId parse, each optional and lower-cased", () => theTwoScopeKeysParseAndAreLowerCased());
  it("assetGroupId, assetId, any unknown key and a non-UUID are refused (.strict())", () =>
    aGroupAnAssetAnUnknownKeyOrANonUuidIsRefused());
});
