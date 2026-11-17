import { describe, it } from "vitest";

import {
  aKwhTariffShowsNoMoney,
  aSmallCorrectionKeepsADecimalInTheFieldAndTheLine,
  anUnpricedDayShowsNoMoney,
  aRegisterPfAboveOneFallsThrough,
  confidenceFollowsTheEvidence,
  noKvahRegisterUsesKva,
  noPathGivesNoAdvisory,
  noTariffShowsTheNoKvahTariffSentence,
  onlyElectricalAssetsQualify,
  onlyPfUsesTheThirdPath,
  theBandPrintsAsSetAndAnOutOfRangeOneIsNamed,
  theKvaPathNeedsCoverage,
  thePfPathNeedsCoverage,
  theRegisterPathNeedsCoverage,
  theRegisterCaseMatchesHandArithmetic,
  theTriggerUsesTheRoundedPf,
} from "./advisory-power-factor.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — low power factor (ADR 0137, plan §4.2)", () => {
  it("registers 8,700 / 10,000 on a kVAh tariff: PF, kVAh, kVAr and money by hand", () =>
    theRegisterCaseMatchesHandArithmetic());
  it("a kWh tariff shows no money and the kWh sentence", () => aKwhTariffShowsNoMoney());
  it("no tariff shows R-j's sentence", () => noTariffShowsTheNoKvahTariffSentence());
  it("an unpriced day: no money, the no-rate sentence, kVAh and kVAr still present", () =>
    anUnpricedDayShowsNoMoney());
  it("no kvah_total → kW ÷ kVA, estimated", () => noKvahRegisterUsesKva());
  it("only pf → the third path; pf 0 and 1.2 hours are left out", () => onlyPfUsesTheThirdPath());
  it("a register PF of 1.04 falls through to kW ÷ kVA", () => aRegisterPfAboveOneFallsThrough());
  it("no path → no advisory", () => noPathGivesNoAdvisory());
  it("0.949 does not fire at 0.95, 0.944 does; a band of 0.9 moves it; 0.99 never fires", () =>
    theTriggerUsesTheRoundedPf());
  it("a band of 0.932 prints as set; a band of 1.2 falls back to 0.95 and says so", () =>
    theBandPrintsAsSetAndAnOutOfRangeOneIsNamed());
  it("registers spanning 0.8 of the window pass; 1 ms less falls through to kW ÷ kVA or to none", () =>
    theRegisterPathNeedsCoverage());
  it("kW ÷ kVA in 135 hours passes; 134 falls through to kW and PF or to none", () => theKvaPathNeedsCoverage());
  it("kW and PF in 135 hours passes; 134 gives no advisory", () => thePfPathNeedsCoverage());
  it("measured needs registers, a band and a billing meter; R-i otherwise", () => confidenceFollowsTheEvidence());
  it("only an electrical asset qualifies", () => onlyElectricalAssetsQualify());
  it("F4.384: a correction under 1 kVAr keeps a decimal in the kvar field and the line", () =>
    aSmallCorrectionKeepsADecimalInTheFieldAndTheLine());
});
