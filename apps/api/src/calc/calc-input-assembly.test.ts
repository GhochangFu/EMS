import { describe, it } from "vitest";

import * as spec from "./calc-input-assembly.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One claim per `it`. */
describe("calc input assembly — the composition both hosts call (ADR 0097 decision 5)", () => {
  it("v1: oldestInputMs is the oldest sample read", () => spec.v1OldestInputIsTheMinimum());
  it("a stale local refuses and keeps the read's time", () => spec.staleLocalKeepsItsTime());
  it("an absent local refuses missing_input with no time", () => spec.absentLocalIsMissing());
  it("parameter_unset refuses before any read", () => spec.parameterUnsetBeforeAnyRead());
  it("the computedThisTick overlay is read before the store", () => spec.overlayIsReadFirst());
  it("v2: every declared member of every aggregate is classified", () => spec.everyMemberIsClassified());
  it("v2: a pure aggregate's oldestInputMs is the oldest member", () => spec.v2OldestInputIsTheOldestMember());
  it("v2: a stale-member refusal keeps the member's time", () => spec.v2StaleMemberRefusalKeepsItsTime());
  it("v2: excluded and membersNotFresh under a coverage ratio", () => spec.excludedOnSuccessUnderARatio());
  it("v2: an unresolved code is unknown_asset_reference", () => spec.unresolvedCodeIsUnknown());
  it("v2: an empty member set is no_members", () => spec.emptyAggregateIsNoMembers());
  it("v3: an absent window answer is windows_unresolved", () => spec.absentWindowAnswerIsUnresolved());
  it("v3: a window answer's own reason passes through", () => spec.windowAnswerReasonPassesThrough());
  it("v3: the window lookup is keyed on the given end, not nowMs", () => spec.windowLookupUsesTheGivenEnd());
  it("planWindowRequests resolves a qualified read through membership", () => spec.planWindowRequestsResolvesQualifiedReads());
});
