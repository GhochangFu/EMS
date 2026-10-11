import { describe, it } from "vitest";

import {
  aBadPathParameterStoresNothing,
  aBodylessEntryStoresTheEmptyObject,
  aClientOnlyFieldNeverReachesTheModel,
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
  it("has one slim propose tool per entry", () => everyEntryHasOneSlimProposeTool());
  it("describes a part of a large body on demand", () => describeChangeReadsAPartOfTheBody());
  it("limits describe_change per turn", () => describeChangeHasAPerTurnBudget());
  it("checks a fill_step and writes nothing", () => fillStepChecksOneStepAndWritesNothing());
});
