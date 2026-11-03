import { describe, it } from "vitest";

import {
  aBadQueryIsA400WithFlatten,
  aCustomRangeReachesEveryCall,
  aForeignAssetIsA403BeforeAnyRead,
  aLoweredCapRefusesBeforeAnyAggregate,
  aNonUuidAssetIdIsA400BeforeTheScope,
  anUnregisteredCodeIsA404NamingNoCode,
  csvAndXlsxAreTheWritersOverTheRows,
  eachAggregateCallCarriesTheQuery,
  theHeaderBlockReadsTheResponseZone,
  theLargestHistoryCountsExactly46080,
  theLargestHistoryPassesTheRealCap,
  theRegistrationSelectIsTheAssetsActiveRows,
  theRowsCarryTheResponseBuckets,
  theScopeRunsBeforeTheQuery,
} from "./asset-history-export.service.spec";

/** `F4.303` U5 — Vitest entry point for `AssetHistoryExportService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — AssetHistoryExportService (ADR 0108 Amendment 6 item 3)", () => {
  it("H1: a non-UUID asset id is a 400 before the scope check", () => aNonUuidAssetIdIsA400BeforeTheScope());
  it("H2: a foreign asset is a 403 before the select and any read", () => aForeignAssetIsA403BeforeAnyRead());
  it("H2: the scope runs before the query", () => theScopeRunsBeforeTheQuery());
  it("H2: a bad query is a 400 with flatten()", () => aBadQueryIsA400WithFlatten());
  it("H3: an unregistered code is a 404 naming no code, with no aggregate", () => anUnregisteredCodeIsA404NamingNoCode());
  it("H3: the registration select reads the asset's active rows", () => theRegistrationSelectIsTheAssetsActiveRows());
  it("H4: a lowered cap refuses before any aggregate call", () => aLoweredCapRefusesBeforeAnyAggregate());
  it("H5: 8 points x 2 880 buckets x 2 periods passes the real cap", () => theLargestHistoryPassesTheRealCap());
  it("H5: that count is exactly 46 080", () => theLargestHistoryCountsExactly46080());
  it("H6: each aggregate call carries bucketStats, the function, compare and the range", () =>
    eachAggregateCallCarriesTheQuery());
  it("H6: a custom range reaches every call; the function defaults to avg", () => aCustomRangeReachesEveryCall());
  it("H7: the rows carry the response buckets and their statistics", () => theRowsCarryTheResponseBuckets());
  it("H8: the header block reads the response zone and the level", () => theHeaderBlockReadsTheResponseZone());
  it("csv and xlsx are the writers over the rows", () => csvAndXlsxAreTheWritersOverTheRows());
});
