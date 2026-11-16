import { describe, it } from "vitest";

import {
  aLiveRoleTooCloseToTheActualIsSkipped,
  aLiveRoleTooCloseToThePastIsSkipped,
  aPastRoleTooCloseToTheActualIsSkipped,
  aPastRoleWithNoLivePartnerIsSkipped,
  deltaE2000MatchesTheReferenceData,
  theRuledRolesStayWhereTheyHold,
  withNoPairThatHoldsTheRuledOrderStays,
} from "./forecast-colours.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.381 three forecast colours at least ΔE2000 20 apart", () => {
  it("ΔE2000 matches the reference data", () => {
    deltaE2000MatchesTheReferenceData();
  });
  it("the ruled roles stay where they hold", () => {
    theRuledRolesStayWhereTheyHold();
  });
  it("a past role too close to the actual is skipped (sand light)", () => {
    aPastRoleTooCloseToTheActualIsSkipped();
  });
  it("a live role too close to the actual is skipped (the default light theme)", () => {
    aLiveRoleTooCloseToTheActualIsSkipped();
  });
  it("a live role too close to the past is skipped", () => {
    aLiveRoleTooCloseToThePastIsSkipped();
  });
  it("a past role with no live partner is skipped", () => {
    aPastRoleWithNoLivePartnerIsSkipped();
  });
  it("with no pair that holds, the ruled order stays", () => {
    withNoPairThatHoldsTheRuledOrderStays();
  });
});
