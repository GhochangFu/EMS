import { describe, it } from "vitest";

import {
  assertAdminReadMarksInactiveOverrideCode,
  assertCatalogListOrdersByHeadlineRankThenCode,
  assertEveryActiveDomainIsReturned,
  assertInactiveCodeIsAbsentFromCatalogDefaults,
  assertInactiveCodeIsAbsentFromPoints,
  assertInactiveDomainIsNotReturned,
  assertOverrideForInactiveDomainIsIgnored,
  assertOverrideListOrdersBySortOrder,
  assertOverrideOfInactiveCodesOnlyStaysOrganization,
  assertOverrideSegmentCarriesCatalogDefaults,
  assertPointCarriesNameAndUnit,
  assertSegmentWithRowsIsOrganization,
  assertSegmentWithoutRowsIsCatalog,
  assertUpdatedStampFollowsTheSource,
} from "./trend-points.pure.spec";

/**
 * `F4.300` — Vitest wrapper for the pure trend-point resolution rule (ADR 0108
 * decision 3.4). Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.300 — resolveSegments", () => {
  it("P1 a segment with override rows reads source organization", () => {
    assertSegmentWithRowsIsOrganization();
  });

  it("P2 a segment with no override row reads source catalog", () => {
    assertSegmentWithoutRowsIsCatalog();
  });

  it("P3 the catalog list orders headline_rank NULLS LAST, then code", () => {
    assertCatalogListOrdersByHeadlineRankThenCode();
  });

  it("P4 the override list orders by sort_order", () => {
    assertOverrideListOrdersBySortOrder();
  });

  it("P5 an inactive code is absent from points", () => {
    assertInactiveCodeIsAbsentFromPoints();
  });

  it("P6 an inactive code is absent from catalogDefaults", () => {
    assertInactiveCodeIsAbsentFromCatalogDefaults();
  });

  it("P7 every active domain is returned, even with zero points", () => {
    assertEveryActiveDomainIsReturned();
  });

  it("P8 an inactive domain is not returned", () => {
    assertInactiveDomainIsNotReturned();
  });

  it("P9 an override segment carries the catalog defaults beside its list", () => {
    assertOverrideSegmentCarriesCatalogDefaults();
  });

  it("P10 the updated stamp follows the source", () => {
    assertUpdatedStampFollowsTheSource();
  });

  it("P11 the admin read keeps an inactive override code, marked inactive", () => {
    assertAdminReadMarksInactiveOverrideCode();
  });

  it("P12 rows naming only inactive codes still read organization", () => {
    assertOverrideOfInactiveCodesOnlyStaysOrganization();
  });

  it("P13 an override row for an inactive domain is ignored", () => {
    assertOverrideForInactiveDomainIsIgnored();
  });

  it("P14 a point carries the catalog row's name and unit", () => {
    assertPointCarriesNameAndUnit();
  });
});
