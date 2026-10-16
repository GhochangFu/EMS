import { describe, it } from "vitest";

import {
  assertALayoutWithLiveRolesStoresACard,
  assertAnAdminsLayoutWithAMissingRoleGetsTheRoleCardFirst,
  assertAnOrgAdminCannotProposeTheRoleCard,
  assertAnOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm,
  assertAStaleLayoutReplaceIsRefusedAtPropose,
} from "./copilot-turn-layouts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 5 — the role card before the layout (owner ruling Q4)", () => {
  it("F3.87 PR 6 (Q4-a): gives an admin's layout with a missing role the admin form, then stores the role card", () =>
    assertAnAdminsLayoutWithAMissingRoleGetsTheRoleCardFirst());
  it("F3.87 PR 5 (Q4-c): gives an organization admin the sentence form and stores no card", () =>
    assertAnOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm());
  it("F3.87 PR 6 (Q4-c): an organization admin's turn has no assetRole.create tool and stores no card", () =>
    assertAnOrgAdminCannotProposeTheRoleCard());
  it("F3.87 PR 5 (Q4-b): stores a card for a layout whose roles are live", () => assertALayoutWithLiveRolesStoresACard());
  it("F3.87 PR 5 (Q4-d): refuses a stale layout replace at propose time", () => assertAStaleLayoutReplaceIsRefusedAtPropose());
});
