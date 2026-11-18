import { describe, it } from "vitest";

import {
  aFullResponseParses,
  anExtraKeyParses,
  anUnknownKindIsRefused,
  anUnknownStatusIsRefused,
  daysToLimitMinOfZeroIsRefused,
  daysToLimitMaxNullParses,
  twentyDaysWithDataIsRefused,
  emptyIndicatorsAndAssumptionsAreRefused,
  theConstantsAreTheAdrsNumbers,
  theFixedStringsAreTheAdrsText,
  theDriftTargetsAreTwentyOneWithoutKwhTotal,
} from "./degradation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — the degradation contract (ADR 0138)", () => {
  it("a full response parses", () => aFullResponseParses());
  it("kind `rul` is refused", () => anUnknownKindIsRefused());
  it("status `failed` is refused", () => anUnknownStatusIsRefused());
  it("`daysToLimit.min: 0` is refused", () => daysToLimitMinOfZeroIsRefused());
  it("`daysToLimit.max: null` parses", () => daysToLimitMaxNullParses());
  it("`daysWithData: 20` is refused", () => twentyDaysWithDataIsRefused());
  it("empty `indicators` and empty `assumptions` are refused", () => emptyIndicatorsAndAssumptionsAreRefused());
  it("an extra key parses (responses are not strict)", () => anExtraKeyParses());
  it("the constants are 28, 21, 3, 0.05, 1, 90, 200, 10, fair", () => theConstantsAreTheAdrsNumbers());
  it("the five fixed strings are the ADR's text", () => theFixedStringsAreTheAdrsText());
  it("21 drift targets, none a `kwh_total`", () => theDriftTargetsAreTwentyOneWithoutKwhTotal());
});
