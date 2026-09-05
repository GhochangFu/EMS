import { describe, it } from "vitest";

import {
  assertADeactivatedRackKwRowCannotLockTheBoot,
  assertEveryStatementIsBoundedToOneOrganization,
  assertItKwReadsRackKwHereAndOnlyHere,
  assertRackKwRowsSatisfyTheSourceRefCheck,
  assertReSeedingNeverRewritesAPublishedVersion,
  assertTheDialectIsAParameterAndTheRowsAreScheduled,
  assertTheIncomerTemplateKeepsItsHealthBand,
  assertThePinMovesOnlyABaselinePinOfAnIncomer,
  assertTheRackKwRowsAreSeededBeforeTheHealthBaselines,
  assertTheThreeFormulasParseUnderV2,
  assertTheVerifyAgreesWithThePinOnTheBaselineVersion,
  assertTheVerifyReadsBackEveryWrite,
} from "./pue-demo-seed.spec";

describe("F2.8 — the demo PUE seed: one incomer template per site on bms-calc-v2", () => {
  it("parses the three formulas under v2 with the expected references", () => {
    assertTheThreeFormulasParseUnderV2();
  });

  it("reads rack_kw for it_kw here, and only here", () => {
    assertItKwReadsRackKwHereAndOnlyHere();
  });

  it("never rewrites a published version on a re-seed", () => {
    assertReSeedingNeverRewritesAPublishedVersion();
  });

  it("moves only a baseline pin, selected by the incoming-supply role", () => {
    assertThePinMovesOnlyABaselinePinOfAnIncomer();
  });

  it("passes the dialect as a parameter and schedules the rows at 60 s", () => {
    assertTheDialectIsAParameterAndTheRowsAreScheduled();
  });

  it("writes rack_kw rows that satisfy the source_ref check", () => {
    assertRackKwRowsSatisfyTheSourceRefCheck();
  });

  it("keeps the health band on the incomer template", () => {
    assertTheIncomerTemplateKeepsItsHealthBand();
  });

  it("bounds every statement to one organization", () => {
    assertEveryStatementIsBoundedToOneOrganization();
  });

  it("reads back every write in its post-condition", () => {
    assertTheVerifyReadsBackEveryWrite();
  });

  it("writes the rack_kw catalog rows before the health baselines read them", () => {
    assertTheRackKwRowsAreSeededBeforeTheHealthBaselines();
  });

  it("does not let a deactivated rack_kw row lock the boot", () => {
    assertADeactivatedRackKwRowCannotLockTheBoot();
  });

  it("counts only the baseline version the pin is allowed to move", () => {
    assertTheVerifyAgreesWithThePinOnTheBaselineVersion();
  });
});
