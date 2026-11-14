import { describe, it } from "vitest";

import * as spec from "./asset-filter-scope.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 U2 — AssetFilterScopeService.narrow without a database (ADR 0132)", () => {
  it("an empty filter returns the readable value untouched and reads nothing", () => spec.assertAnEmptyFilterReturnsTheReadableSetUnread());
  it("a foreign asset is [] before any read", () => spec.assertAForeignAssetIsEmptyUnread());
  it("an unreadable location is [] before any walk (P2)", () => spec.assertAnUnreadableLocationIsEmptyUnread());
  it("an unreadable group is [] and the assets are never read (build note 4)", () =>
    spec.assertAnUnreadableGroupIsEmptyBeforeTheAssetsRead());
  it("a caller who reads no asset gets [] for any filter", () => spec.assertAnEmptyReadableSetStaysEmpty());
  it("a set key is never null, even for the admin", () => spec.assertASetKeyIsNeverNull());
  it("the assets read is ANDed onto the readable ids", () => spec.assertTheAssetsReadCarriesTheReadableIds());
});
