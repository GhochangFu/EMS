import { describe, it } from "vitest";

import {
  assertBuiltinCannotCarryDashboardId,
  assertBuiltinShapeParses,
  assertDashboardShapeParses,
  assertGeneratedCannotCarryBuiltinKey,
  assertGeneratedShapeParses,
  assertMismatchedPairIsRefused,
  assertUnknownKeyIsRefused,
} from "./site-control-room-view.schema.spec";

/**
 * `F3.67` — Vitest wrapper for `putSiteControlRoomViewBodySchema`. Assertions
 * live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F3.67 — putSiteControlRoomViewBodySchema", () => {
  it("B1 a generated body parses with neither field set", () => {
    assertGeneratedShapeParses();
  });

  it("B2 a dashboard body parses with its dashboardId", () => {
    assertDashboardShapeParses();
  });

  it("B3 a builtin body parses with its builtinKey", () => {
    assertBuiltinShapeParses();
  });

  it("B4 a mismatched pair is refused", () => {
    assertMismatchedPairIsRefused();
  });

  it("B5 an unknown top-level key is refused (.strict())", () => {
    assertUnknownKeyIsRefused();
  });

  it("B6 a builtin body carrying dashboardId is refused", () => {
    assertBuiltinCannotCarryDashboardId();
  });

  it("B7 a generated body carrying builtinKey is refused", () => {
    assertGeneratedCannotCarryBuiltinKey();
  });
});
