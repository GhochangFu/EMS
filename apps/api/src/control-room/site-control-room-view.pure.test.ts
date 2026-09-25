import { describe, it } from "vitest";

import {
  assertAssetScopedDashboardIsOutOfScope,
  assertGeneratedRowIsGenerated,
  assertGroupScopedDashboardIsTheView,
  assertKnownBuiltinIsTheView,
  assertNoRowIsGeneratedWithoutNotice,
  assertOtherOrganizationDashboardIsOutOfScope,
  assertRemovedDashboardFailsSafe,
  assertRescopedDashboardIsOutOfScope,
  assertSiteScopedDashboardIsTheView,
  assertUnknownBuiltinFailsSafe,
} from "./site-control-room-view.pure.spec";

/**
 * `F3.67` — Vitest wrapper for the pure site Control Room view resolver.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F3.67 — resolveSiteControlRoomView", () => {
  it("P1 no row is the generated view, with no notice", () => {
    assertNoRowIsGeneratedWithoutNotice();
  });

  it("P2 a generated row is the generated view", () => {
    assertGeneratedRowIsGenerated();
  });

  it("P3 a site-scoped dashboard is the view, with its slug", () => {
    assertSiteScopedDashboardIsTheView();
  });

  it("P4 a dashboard scoped to one of the site's asset groups is the view", () => {
    assertGroupScopedDashboardIsTheView();
  });

  it("P5 a removed dashboard answers generated with dashboard_removed", () => {
    assertRemovedDashboardFailsSafe();
  });

  it("P6 a dashboard re-scoped to another site answers dashboard_out_of_scope", () => {
    assertRescopedDashboardIsOutOfScope();
  });

  it("P7 a dashboard in another organization answers dashboard_out_of_scope", () => {
    assertOtherOrganizationDashboardIsOutOfScope();
  });

  it("P8 an asset-scoped dashboard is never eligible (D6)", () => {
    assertAssetScopedDashboardIsOutOfScope();
  });

  it("P9 a known built-in key is the view", () => {
    assertKnownBuiltinIsTheView();
  });

  it("P10 an unknown built-in key answers generated with builtin_unknown", () => {
    assertUnknownBuiltinFailsSafe();
  });
});
