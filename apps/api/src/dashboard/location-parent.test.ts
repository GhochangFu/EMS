import { describe, it } from "vitest";

import {
  assertAnEmptyScopeGivesAnEmptyMap,
  assertEachLocationKeepsTheScopesParentId,
  assertTheMapDoesNotReDecideVisibility,
} from "./location-parent.spec";

/** `F4.240` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.240 — the dashboard's parent map is the scope's own (ADR 0139 decision 12)", () => {
  it("L1 — each scope location keeps the scope's parentId, null included", () => {
    assertEachLocationKeepsTheScopesParentId();
  });

  it("L2 — the map passes the scope's parentId through and adds nothing", () => {
    assertTheMapDoesNotReDecideVisibility();
  });

  it("L3 — an empty scope gives an empty map", () => {
    assertAnEmptyScopeGivesAnEmptyMap();
  });
});
