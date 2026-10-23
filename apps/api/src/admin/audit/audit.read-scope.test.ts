import { describe, it } from "vitest";

import {
  assertARestrictionIntersectsTheScopedReader,
  assertARestrictionNarrowsTheUnfilteredScope,
  assertAnEmptyIntersectionFailsClosed,
  assertNoRestrictionKeepsTheScopedReader,
  assertNoRestrictionKeepsTheUnfilteredScope,
} from "./audit.read-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per case. */
describe("F4.277 — the audit read's organization restriction", () => {
  it("no restriction keeps the global admin's unfiltered scope", assertNoRestrictionKeepsTheUnfilteredScope);
  it("no restriction keeps a scoped reader's own scope", assertNoRestrictionKeepsTheScopedReader);
  it("a restriction narrows the unfiltered scope to the restricted organizations", assertARestrictionNarrowsTheUnfilteredScope);
  it("a restriction intersects a scoped reader's scope", assertARestrictionIntersectsTheScopedReader);
  it("an empty intersection is [] (matches nothing), never null", assertAnEmptyIntersectionFailsClosed);
});
