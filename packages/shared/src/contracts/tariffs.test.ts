import { describe, it } from "vitest";

import {
  assertACustomKeyNeedsThePrefix,
  assertAGapInSlabBoundsIsRefused,
  assertAJavascriptUrlIsRefused,
  assertAMidMonthDateIsRefused,
  assertAnEmptyPatchIsRefused,
  assertAnOpenSlabThatIsNotLastIsRefused,
  assertEffectiveToMustFollowEffectiveFrom,
  assertUnknownKeysAreRefused,
  assertValidBodiesParse,
} from "./tariffs.spec";

/** `F4.365` U1 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — tariff contracts", () => {
  it("parses a valid revision, mapping and slab list", () => assertValidBodiesParse());
  it("refuses a gap in slab bounds", () => assertAGapInSlabBoundsIsRefused());
  it("refuses an open slab that is not last", () => assertAnOpenSlabThatIsNotLastIsRefused());
  it("refuses a javascript: source URL", () => assertAJavascriptUrlIsRefused());
  it("refuses unknown keys on every strict body", () => assertUnknownKeysAreRefused());
  it("refuses an empty PATCH", () => assertAnEmptyPatchIsRefused());
  it("refuses a date that is not the first of a month", () => assertAMidMonthDateIsRefused());
  it("a custom line's key starts with custom:", () => assertACustomKeyNeedsThePrefix());
  it("effectiveTo must follow effectiveFrom", () => assertEffectiveToMustFollowEffectiveFrom());
});
