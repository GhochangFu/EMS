import { describe, it } from "vitest";

import {
  assertALayoutWithLiveRolesStoresACard,
  assertAnAdminsLayoutWithAMissingRoleIsRefusedNamingIt,
  assertAnOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm,
  assertAStaleLayoutReplaceIsRefusedAtPropose,
} from "./copilot-turn-layouts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.87 PR 5 — the role card before the layout (owner ruling Q4)", () => {
  it("F3.87 PR 5 (Q4-a): refuses an admin's layout with a missing role, naming it, and stores no card", () =>
    assertAnAdminsLayoutWithAMissingRoleIsRefusedNamingIt());
  it("F3.87 PR 5 (Q4-c): gives an organization admin the sentence form and stores no card", () =>
    assertAnOrgAdminsLayoutWithAMissingRoleGetsTheSentenceForm());
  it("F3.87 PR 5 (Q4-b): stores a card for a layout whose roles are live", () => assertALayoutWithLiveRolesStoresACard());
  it("F3.87 PR 5 (Q4-d): refuses a stale layout replace at propose time", () => assertAStaleLayoutReplaceIsRefusedAtPropose());
});
