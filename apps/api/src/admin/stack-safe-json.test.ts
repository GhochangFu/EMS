import { describe, it } from "vitest";

import {
  assertCloneJsonIsIndependentAndOrdered,
  assertCloneJsonIsIterative,
  assertCloneJsonKeepsProtoAsData,
  assertCloneJsonReturnsANonJsonObjectByReference,
  assertExceedsDepthCountsFromTheRoot,
  assertExceedsDepthIsIterative,
} from "./stack-safe-json.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per exported assert-function, deliberately: a suite that ran every
 * claim from a single `it()` dies at its first failing `assert` and proves
 * nothing about the claims after it, which is exactly what the mutation table
 * in `docs/plans/f4.115-draft-nesting-depth.md` §4 has to distinguish.
 */
describe("stack-safe JSON walkers (F4.115)", () => {
  it("counts the value it is handed as level 1", () => {
    assertExceedsDepthCountsFromTheRoot();
  });

  it("answers a 20,000-deep chain instead of throwing out of it", () => {
    assertExceedsDepthIsIterative();
  });

  it("clones independently of the source and in the source's key order", () => {
    assertCloneJsonIsIndependentAndOrdered();
  });

  it("keeps an own __proto__ as data instead of reparenting the copy", () => {
    assertCloneJsonKeepsProtoAsData();
  });

  it("clones a 20,000-deep value down to its leaf", () => {
    assertCloneJsonIsIterative();
  });

  it("carries a Date or a Map across by reference instead of rebuilding it", () => {
    assertCloneJsonReturnsANonJsonObjectByReference();
  });
});
