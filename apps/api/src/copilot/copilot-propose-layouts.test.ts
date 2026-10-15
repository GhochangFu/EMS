import { describe, it } from "vitest";

import * as L from "./copilot-propose-layouts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 5 — the layout proposals (Amendment 3 A2, owner rulings Q4 and Q5)", () => {
  it("refuses a layout on a dead library with the service's sentence", () => L.aLayoutOnADeadLibraryIsRefusedWithTheServicesSentence());
  it("refuses a stale replace at propose time with the route's 409 sentence", () => L.aStaleReplaceIsRefusedAtPropose());
  it("stores the baseline in a replace body", () => L.aStoredReplaceCarriesItsBaseline());
  it("leaves the baseline out of the stored hash", () => L.aStoredReplaceHashLeavesOutTheBaseline());
  it("stores a create with no baseline", () => L.aStoredCreateHasNoBaseline());
  it("tells a global admin to propose a missing role first", () => L.anAdminsLayoutWithAMissingRoleIsToldToProposeTheRoleFirst());
  it("gives an organization admin the sentence form", () => L.anOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm());
  it("stores a replace that keeps a stored retired role", () => L.aReplaceKeepingAStoredRetiredRoleIsStored());
  it("gives a replace with a truly missing role the role sentence", () => L.aReplaceWithATrulyMissingRoleGetsTheRoleSentence());
  it("refuses a layout when the tool set has no layouts service", () => L.aLayoutWithoutTheServiceIsRefused());
  it("refuses a baseline the model sends itself", () => L.aModelSentBaselineIsRefused());
});
