import { describe, it } from "vitest";

import {
  aFixedBodyParsesWithTheRoutesBody,
  noVocabularyRouteIsExcluded,
  theCopilotDeactivateSummaryNamesTheCountedOrganization,
  theDeactivateSummaryStatesTheUsage,
  theDirectionEntriesCarryTheRuledRisk,
  theFixedBodiesAreTheTwoDirections,
  theFixedBodyStepRuleIsNotVacuous,
  theModelBodyOfTheRoleEditHasNoActive,
  theRoleEditStepHasNoActive,
  theSevenVocabularyEntriesAreForTheGlobalAdminAlone,
  theSummariesNameTheCode,
  theVocabularyTargetsNameTheCodeParameter,
} from "./vocabularies.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.282 — the location-type and unit-role vocabulary entries", () => {
  it("offers the seven entries to the global admin alone", () => theSevenVocabularyEntriesAreForTheGlobalAdminAlone());
  it("gives each direction entry the ruled risk", () => theDirectionEntriesCarryTheRuledRisk());
  it("names the code parameter on every vocabulary target", () => theVocabularyTargetsNameTheCodeParameter());
  it("parses each fixed body with the route's body", () => aFixedBodyParsesWithTheRoutesBody());
  it("fixes the two directions of active", () => theFixedBodiesAreTheTwoDirections());
  it("refuses a fixed-body entry with a step", () => theFixedBodyStepRuleIsNotVacuous());
  it("excludes no vocabulary route", () => noVocabularyRouteIsExcluded());
  it("states the location count on a deactivate card", () => theDeactivateSummaryStatesTheUsage());
  it("names the counted organization on the copilot's deactivate card", () =>
    theCopilotDeactivateSummaryNamesTheCountedOrganization());
  it("keeps active out of the role edit's model body", () => theModelBodyOfTheRoleEditHasNoActive());
  it("keeps active out of the role edit's step", () => theRoleEditStepHasNoActive());
  it("names the code beside the label in each role summary", () => theSummariesNameTheCode());
});
