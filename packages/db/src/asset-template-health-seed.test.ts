import { describe, it } from "vitest";

import {
  assertEveryStatementIsBoundedToOneOrganization,
  assertNoAssetIsPinnedAcrossDomains,
  assertReSeedingNeverRewritesAPublishedVersion,
  assertTheBaselineWeightsNothing,
  assertTheClientsFiveBandsAreSeeded,
  assertTheDeclaredPointsAreMeasuredAndNotDerived,
  assertTheDeclaredPointsClaimNoWiring,
  assertTheInsertAndTheVerifySelectTheSameTemplates,
  assertThePinNeverReversesAnOperatorsMigration,
  assertTheVerifyReadsBackWhatMakesABandNull,
} from "./asset-template-health-seed.spec";

describe("F4.75 — a seeded health baseline per domain", () => {
  it("seeds the client's five bands", () => {
    assertTheClientsFiveBandsAreSeeded();
  });

  it("weights nothing, so every ruled tag counts equally", () => {
    assertTheBaselineWeightsNothing();
  });

  it("never rewrites a published version on a re-seed", () => {
    assertReSeedingNeverRewritesAPublishedVersion();
  });

  it("never reverses an operator's own template migration", () => {
    assertThePinNeverReversesAnOperatorsMigration();
  });

  it("never pins an asset to another domain's template", () => {
    assertNoAssetIsPinnedAcrossDomains();
  });

  it("bounds every statement to one organization", () => {
    assertEveryStatementIsBoundedToOneOrganization();
  });

  it("declares points that claim no wiring", () => {
    assertTheDeclaredPointsClaimNoWiring();
  });

  it("declares measured points, which stay out of the calc merge", () => {
    assertTheDeclaredPointsAreMeasuredAndNotDerived();
  });

  it("selects the same templates in the insert and in its post-condition", () => {
    assertTheInsertAndTheVerifySelectTheSameTemplates();
  });

  it("reads back the states that would make every band null", () => {
    assertTheVerifyReadsBackWhatMakesABandNull();
  });
});
