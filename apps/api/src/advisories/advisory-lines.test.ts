import { describe, it } from "vitest";

import {
  aThreeDecimalBandNeverPrintsEqualToThePf,
  anOutOfRangeBandIsNamedAsIgnored,
  anUnpricedTariffMonthSaysNoRate,
  moneyReadsInTheOrganizationsCurrency,
  noSentenceHoldsAPercentOrASaving,
  theAssumptionsAreExact,
  theContextUsesTheImportedWeakSignalSentences,
  theExcessSentencesAreExact,
  thePowerFactorSentencesAreExact,
  theScopeWordComesFromTheRank,
} from "./advisory-lines.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — the advisory sentences (ADR 0137, plan §4.4)", () => {
  it("the power-factor headline and lines are exact", () => thePowerFactorSentencesAreExact());
  it("a 3-decimal band prints as set; the headline never reads the PF equal to it", () =>
    aThreeDecimalBandNeverPrintsEqualToThePf());
  it("a band outside 0–1 is named as ignored, not as unset", () => anOutOfRangeBandIsNamedAsIgnored());
  it("an unpriced tariff month (NaN at rank −1) says no rate", () => anUnpricedTariffMonthSaysNoRate());
  it("the excess headline and lines are exact", () => theExcessSentencesAreExact());
  it("`₹ 12,340` for INR, `USD 12,340` otherwise, and `no USD is shown`", () =>
    moneyReadsInTheOrganizationsCurrency());
  it("the scope word comes from the rank", () => theScopeWordComesFromTheRank());
  it("every assumption is exact; dates are in the asset's zone", () => theAssumptionsAreExact());
  it("the context uses the imported weak-signal sentences unchanged", () =>
    theContextUsesTheImportedWeakSignalSentences());
  it("no sentence holds `%` or the word saving", () => noSentenceHoldsAPercentOrASaving());
});
