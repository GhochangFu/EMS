import { describe, it } from "vitest";

import {
  aWidgetWithNoRoleIsBound,
  aWidgetWithOneDeadRoleIsPartial,
  matchedMembersCountsEachMemberOnce,
  theTieBreakIsTheFirstMemberByCodeAcrossBindings,
} from "./template-instantiation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per
 * claim, so a failing claim reddens only its own. */
describe("F3.73 — planTemplateWidget, the planner moved from the instantiate service", () => {
  it("a widget with one dead role is partial, not bound", () => {
    aWidgetWithOneDeadRoleIsPartial();
  });

  it("matchedMembers counts each member once across bindings", () => {
    matchedMembersCountsEachMemberOnce();
  });

  it("the tie-break is the first member by code across every binding", () => {
    theTieBreakIsTheFirstMemberByCodeAcrossBindings();
  });

  it("a widget that names no role is bound", () => {
    aWidgetWithNoRoleIsBound();
  });
});
