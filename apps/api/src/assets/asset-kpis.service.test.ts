import { describe, it } from "vitest";

import * as spec from "./asset-kpis.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One claim per `it`. */
describe("F2.33 — the KPI read host (ADR 0097)", () => {
  it("an asset with no template lists nothing and reads nothing", () => spec.noTemplateIsAnEmptyList());
  it("an absent asset is a 404", () => spec.absentAssetIsNotFound());
  it("a malformed kpis slice lists nothing and warns once", () => spec.malformedSliceWarnsAndListsNothing());
  it("an unvalidated KPI is listed and never evaluated", () => spec.unvalidatedIsListedNotEvaluated());
  it("v1: a value, ok, and the oldest input as inputAsOf", () => spec.v1OkCarriesTheOldestInput());
  it("a sample exactly windowMinutes old is fresh", () => spec.sampleAtTheWindowEdgeIsFresh());
  it("a sample one second past windowMinutes is stale and keeps its time", () => spec.sampleOneSecondPastTheWindowIsStale());
  it("v2: a silent member is counted as excluded and never named", () => spec.v2MissingMemberIsCountedNeverNamed());
  it("v2: every member fresh gives the sum", () => spec.v2AllFreshIsTheSum());
  it("v3: an unset $key is parameter_unset", () => spec.v3ParameterUnset());
  it("v3: the window end is the request time floored to the minute", () => spec.v3WindowEndIsTheMinuteFloor());
  it("a non-finite result is non_finite", () => spec.nonFiniteIsAState());
  it("items keep the template's declared order", () => spec.declaredOrderIsKept());
  it("one membership call serves every KPI", () => spec.oneMembershipCallForEveryKpi());
  it("an item carries the ruled fields and nothing else", () => spec.responseCarriesOnlyTheRuledFields());
});
