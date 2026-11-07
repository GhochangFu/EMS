import { describe, it } from "vitest";

import {
  aBodyChoiceOverridesTheCarriedPick,
  aGroupIsCarriedOnce,
  anOldPickIsCarriedByTabKey,
  anOldPickThePlannerWouldRefuseIsNotCarried,
  theOutcomeFollowsTheCopyAndTheMode,
} from "./site-layout-replace.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.320 PR 2 — the pure rules of Replace (ADR 0087 Amendment 4 decisions 4, 5)", () => {
  it("carries an old group pick by tab key", () => anOldPickIsCarriedByTabKey());
  it("lets a tabGroups entry override the carried pick", () => aBodyChoiceOverridesTheCarriedPick());
  it("never carries a pick the planner would refuse", () => anOldPickThePlannerWouldRefuseIsNotCarried());
  it("carries one group once", () => aGroupIsCarriedOnce());
  it("answers no_copy, other_template, same_version or newer_version (bulk), or replace", () =>
    theOutcomeFollowsTheCopyAndTheMode());
});
