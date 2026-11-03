import { describe, it } from "vitest";

import * as spec from "./trend-points-report.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.303 U10 — report template enum and schedule params (ADR 0108 Amendment 6 items 6, 8)", () => {
  it("R1: reportTemplateIdSchema.options is exactly energy_consumption and trend_points", () =>
    spec.templateIdIsExactlyTheTwoValues());

  it("R2: the energy arm admits compare false", () => spec.energyParamsAdmitsCompareFalse());
  it("R2: the energy arm refuses a string compare", () => spec.energyParamsRefusesAStringCompare());
  it("R2: the energy arm refuses an empty object", () => spec.energyParamsRefusesAnEmptyObject());
  it("R2: the energy arm refuses an unknown key", () => spec.energyParamsRefusesAnUnknownKey());

  it("R3: the trend arm admits one pair with compare", () => spec.trendParamsAdmitsOnePairWithCompare());
  it("R3: the trend arm refuses no points", () => spec.trendParamsRefusesNoPoints());
  it("R3: the trend arm refuses nine points", () => spec.trendParamsRefusesNinePoints());
  it("R3: the trend arm refuses a non-uuid asset id", () => spec.trendParamsRefusesANonUuidAsset());
  it("R3: the trend arm refuses a point key with a space", () => spec.trendParamsRefusesABadPointKey());
  it("R3: the trend arm refuses an item with an extra key", () => spec.trendParamsRefusesAnItemWithAnExtraKey());
  it("R3: the trend arm refuses a missing compare", () => spec.trendParamsRefusesAMissingCompare());

  it("R4: { compare } parses as the energy arm (no points)", () => spec.unionParsesCompareAloneAsTheEnergyArm());
  it("R4: { points, compare } parses as the trend arm (points)", () => spec.unionParsesPointsAsTheTrendArm());
  it("R4: { compare, points } parses as the trend arm only", () =>
    spec.unionParsesCompareWithPointsAsTheTrendArmOnly());

  it("R5: the create body defaults templateId to energy_consumption, params absent", () =>
    spec.createBodyDefaultsTheTemplateToEnergy());
  it("R5: the create body admits trend_points with params", () =>
    spec.createBodyAdmitsATrendPointsTemplateWithParams());
  it("R5: the create body refuses templateId pdf", () => spec.createBodyRefusesAnUnknownTemplate());
  it("R5: the create body refuses params { compare: 'x' }", () => spec.createBodyRefusesABadParamsArm());

  it("R6: the update body refuses templateId", () => spec.updateBodyRefusesTheTemplateId());
  it("R6: the update body refuses params", () => spec.updateBodyRefusesParams());

  it("R7: the DTO admits params null", () => spec.dtoAdmitsNullParams());
  it("R7: the DTO admits the energy arm", () => spec.dtoAdmitsTheEnergyArm());
  it("R7: the DTO admits the trend arm", () => spec.dtoAdmitsTheTrendArm());
  it("R7: the DTO refuses params []", () => spec.dtoRefusesArrayParams());

  it("R8: the copilot model body still refuses templateId", () => spec.copilotModelBodyRefusesTheTemplateId());
});
