import { describe, it } from "vitest";

import * as spec from "./asset-kpis-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.33 asset KPI view helpers", () => {
  it("a value carries its unit", () => spec.valueCarriesItsUnit());
  it("a value without a unit is the number", () => spec.valueWithoutAUnitIsTheNumber());
  it("a null value is the em dash", () => spec.aNullValueIsTheEmDash());
  it("the excluded sentence names excluded of members", () => spec.excludedSentenceNamesExcludedOfMembers());
  it("no excluded member says so", () => spec.noExcludedMemberSaysSo());
  it("the input-as-of sentence names the time", () => spec.inputAsOfSentenceNamesTheTime());
  it("every state has a sentence", () => spec.everyStateHasASentence());
});
