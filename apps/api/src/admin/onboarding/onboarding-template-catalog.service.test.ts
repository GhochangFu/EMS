import { describe, it } from "vitest";

import {
  assertListStockLiftsTheFormulaKeys,
  assertS1BothReadsFilterByTheOrganization,
  assertS1NoPublishedVersionIssuesOneSelect,
  assertS1PublishedVersionsCarryPointsAndDraftsNone,
  assertS2TheStockProjectionHasNoVersion,
  assertTheContextWithNoOrganizationReadsOnlyTheStock,
  assertTheContextCarriesThePointKeyCatalogWithItsActiveFlag,
  assertThePointKeyCatalogIsOneUnfilteredRead,
} from "./onboarding-template-catalog.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("OnboardingTemplateCatalogService (F3.22, ADR 0091)", () => {
  it("S1 lists every version; published ones carry points and counts, drafts none", async () => {
    await assertS1PublishedVersionsCarryPointsAndDraftsNone();
  });

  it("S1 filters both reads by the organization", async () => {
    await assertS1BothReadsFilterByTheOrganization();
  });

  it("S1 issues no template_points select when nothing is published", async () => {
    await assertS1NoPublishedVersionIssuesOneSelect();
  });

  it("S2 projects the stock catalog with no version", () => {
    assertS2TheStockProjectionHasNoVersion();
  });

  it("F4.205 a stock ref lifts the keys its cross-asset formulas name", () => {
    assertListStockLiftsTheFormulaKeys();
  });

  it("reads only the stock when there is no organization", async () => {
    await assertTheContextWithNoOrganizationReadsOnlyTheStock();
  });

  it("F4.196 carries the point-key catalog with its active flag", async () => {
    await assertTheContextCarriesThePointKeyCatalogWithItsActiveFlag();
  });

  it("F4.196 reads the point-key catalog in one unfiltered select", async () => {
    await assertThePointKeyCatalogIsOneUnfilteredRead();
  });
});
