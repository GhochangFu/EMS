import { describe, it } from "vitest";

import {
  aBadPathParameterStoresNothing,
  aBodylessEntryStoresTheEmptyObject,
  aClientOnlyFieldNeverReachesTheModel,
  aClientOnlyKeyInAProposedBodyIsRefused,
  aRefinedBodyProposesWithItsModelBody,
  aServerProposedEntryHasNoProposeTool,
  aFleetChangeNeedsABoundConversation,
  anAccessChangeNeedsTheUsersOwnAsk,
  theRegistryWithoutAccessNamesNoAccessTool,
  aUserAccountEntryIsRefusedInLocalMode,
  aUserCreateNeverProposesTheGlobalAdmin,
  aFillOrDescribeOfAnAccessEntryNeedsTheUsersOwnAsk,
  aCredentialInAProposeArgumentIsRefused,
  aCrossOrganizationProposalUsesTheAllowedSet,
  aMissingTargetStoresNothing,
  anAccessChangeIsRefusedOnAFollowUp,
  anInvalidBodyStoresNothing,
  anInvalidFormulaStoresNothing,
  aPathParameterIsStoredEncoded,
  aProposalThatLosesTheRaceIsRefused,
  aSecondProposalWhileOneIsOpenIsRefused,
  aTargetOutsideTheAllowedSetStoresNothing,
  aValidBodyStoresTheCanonicalHash,
  describeChangeHasAPerTurnBudget,
  describeChangeReadsAPartOfTheBody,
  eachScopeCheckRefusesAlone,
  everyEntryHasOneSlimProposeTool,
  fillStepChecksOneStepAndWritesNothing,
  anInvalidTemplatePointFormulaStoresNothing,
  anInvalidTemplateKpiExpressionStoresNothing,
  aKpiNamingAPointTheTemplateLacksStoresNothing,
  aKpiMayNameAPointTheBodyDeclares,
  aKpiMayNotNameAStoredPointTheBodyDrops,
  aKpiProposalStoresTheMergedBody,
  aBodyWithoutContentStoresNoContent,
  aStoredUnsafeKeyIsNotCarried,
  storedContentThatCannotBeWrittenBackStoresNothing,
  aTemplatePublishStoresTheEmptyObject,
} from "./copilot-propose-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — the copilot propose tools (ADR 0099 decisions 2, 3, 4, 10)", () => {
  it("stores a valid body with its canonical hash", () => aValidBodyStoresTheCanonicalHash());
  it("stores nothing for an invalid body", () => anInvalidBodyStoresNothing());
  it("refuses a second proposal while one is open", () => aSecondProposalWhileOneIsOpenIsRefused());
  it("refuses a proposal that loses the race to another turn", () => aProposalThatLosesTheRaceIsRefused());
  it("stores nothing for an invalid formula", () => anInvalidFormulaStoresNothing());
  it("stores nothing for a target outside the allowed set", () => aTargetOutsideTheAllowedSetStoresNothing());
  it("resolves a cross-organization proposal in the platform scope", () => aCrossOrganizationProposalUsesTheAllowedSet());
  it("refuses with each scope check alone", () => eachScopeCheckRefusesAlone());
  it("stores nothing for a missing target", () => aMissingTargetStoresNothing());
  it("refuses a credential in a propose argument", () => aCredentialInAProposeArgumentIsRefused());
  it("stores {} for a bodyless entry", () => aBodylessEntryStoresTheEmptyObject());
  it("stores nothing for a bad path parameter", () => aBadPathParameterStoresNothing());
  it("stores the path encoded", () => aPathParameterIsStoredEncoded());
  it("refuses an access change on a follow-up turn", () => anAccessChangeIsRefusedOnAFollowUp());
  it("never shows a clientOnly field to the model", () => aClientOnlyFieldNeverReachesTheModel());
  it("refuses a clientOnly key in a proposed body", () => aClientOnlyKeyInAProposedBodyIsRefused());
  it("proposes a refined body with its modelBody", () => aRefinedBodyProposesWithItsModelBody());
  it("makes no propose tool for a server-proposed entry", () => aServerProposedEntryHasNoProposeTool());
  it("refuses a point-key change outside a bound conversation (ruling Q1)", () => aFleetChangeNeedsABoundConversation());
  it("refuses an access change the user's own message did not ask for (ruling Q3)", () => anAccessChangeNeedsTheUsersOwnAsk());
  it("names no access tool in the second registry", () => theRegistryWithoutAccessNamesNoAccessTool());
  it("refuses a user-account entry in local sign-in (ruling Q8)", () => aUserAccountEntryIsRefusedInLocalMode());
  it("never proposes the global admin role", () => aUserCreateNeverProposesTheGlobalAdmin());
  it("gates fill_step and describe_change on an access entry", () => aFillOrDescribeOfAnAccessEntryNeedsTheUsersOwnAsk());
  it("has one slim propose tool per entry", () => everyEntryHasOneSlimProposeTool());
  it("describes a part of a large body on demand", () => describeChangeReadsAPartOfTheBody());
  it("limits describe_change per turn", () => describeChangeHasAPerTurnBudget());
  it("checks a fill_step and writes nothing", () => fillStepChecksOneStepAndWritesNothing());
});

describe("F3.85 PR 11a — the asset-template propose tools (plan §11.3 Unit 2, ruling Q10)", () => {
  it("stores nothing for an invalid points[0].formula", () => anInvalidTemplatePointFormulaStoresNothing());
  it("stores nothing for an invalid content.kpis[0].expression", () => anInvalidTemplateKpiExpressionStoresNothing());
  it("stores nothing for a KPI naming a point the template lacks", () => aKpiNamingAPointTheTemplateLacksStoresNothing());
  it("lets a KPI name a point the body declares", () => aKpiMayNameAPointTheBodyDeclares());
  it("refuses a KPI naming a stored point the body drops", () => aKpiMayNotNameAStoredPointTheBodyDrops());
  it("stores the merged body for a KPI proposal", () => aKpiProposalStoresTheMergedBody());
  it("adds no content to a body without it", () => aBodyWithoutContentStoresNoContent());
  it("does not carry a stored unsafe key", () => aStoredUnsafeKeyIsNotCarried());
  it("stores nothing when stored content cannot be written back", () => storedContentThatCannotBeWrittenBackStoresNothing());
  it("stores {} for a template publish", () => aTemplatePublishStoresTheEmptyObject());
});
