import { describe, it } from "vitest";

import {
  assertACleanVerifyDoesNotThrow,
  assertARoledAssetLeftOnTheDomainBaselineThrows,
  assertARoleTemplateIsBuiltFromItsOwnClassOnly,
  assertARoleTemplateIsWrittenOnlyForAClassWithPoints,
  assertEveryRoleStatementNamesTheTemplateTheSameWay,
  assertEveryStatementGetsTheOrganizationAndTheBands,
  assertEveryStatementIsBoundedToOneOrganization,
  assertNoAssetIsPinnedAcrossDomains,
  assertReSeedingNeverRewritesAPublishedVersion,
  assertTheBaselineWeightsNothing,
  assertTheClientsFiveBandsAreSeeded,
  assertTheDeclaredPointsAreMeasuredAndNotDerived,
  assertTheDeclaredPointsClaimNoWiring,
  assertTheInsertAndTheVerifySelectTheSameTemplates,
  assertThePinNeverReversesAnOperatorsMigration,
  assertTheRepinTouchesOnlySeedOwnedPins,
  assertTheResultCountsEachWriteOnce,
  assertTheStatementsRunInTheirLoadBearingOrder,
  assertTheVerifyCountsRoledAssetsLeftOnTheDomainBaseline,
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

describe("F2.32 — a seeded baseline per domain and role (ADR 0058 Amendment 3)", () => {
  it("builds a role template from its own class's keys only", () => {
    assertARoleTemplateIsBuiltFromItsOwnClassOnly();
  });

  it("writes a role template only for a class that carries a point", () => {
    assertARoleTemplateIsWrittenOnlyForAClassWithPoints();
  });

  it("names the role template the same way in the insert, the pins and the verify", () => {
    assertEveryRoleStatementNamesTheTemplateTheSameWay();
  });

  it("re-pins only a seed-owned version 1 domain-baseline pin", () => {
    assertTheRepinTouchesOnlySeedOwnedPins();
  });

  it("verifies that no roled asset is left on its domain baseline", () => {
    assertTheVerifyCountsRoledAssetsLeftOnTheDomainBaseline();
  });

  it("runs the statements in their load-bearing order", async () => {
    await assertTheStatementsRunInTheirLoadBearingOrder();
  });

  it("passes the organization to every statement and the bands to both inserts", async () => {
    await assertEveryStatementGetsTheOrganizationAndTheBands();
  });

  it("counts templates, pins and re-pins separately", async () => {
    await assertTheResultCountsEachWriteOnce();
  });

  it("throws when a roled asset is left on its domain baseline", async () => {
    await assertARoledAssetLeftOnTheDomainBaselineThrows();
  });

  it("does not throw on a clean verify", async () => {
    await assertACleanVerifyDoesNotThrow();
  });
});
