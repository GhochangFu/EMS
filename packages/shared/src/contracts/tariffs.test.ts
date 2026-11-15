import { describe, it } from "vitest";

import {
  assertACustomKeyNeedsThePrefix,
  assertAMappingNamesItsMetersInExactlyOneForm,
  assertAGapInSlabBoundsIsRefused,
  assertAJavascriptUrlIsRefused,
  assertAMidMonthDateIsRefused,
  assertAnEmptyPatchIsRefused,
  assertAnOpenSlabThatIsNotLastIsRefused,
  assertEffectiveToMustFollowEffectiveFrom,
  assertTheMeterListIsOneToEightDistinct,
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

/** `F4.373` (ADR 0134 Amendment 3) — several billing meters on one mapping. */
describe("F4.373 — billing meter list on a mapping body", () => {
  it("names the meters in exactly one form; a PATCH replaces or keeps the set", () => assertAMappingNamesItsMetersInExactlyOneForm());
  it("takes 1 to 8 distinct meter ids", () => assertTheMeterListIsOneToEightDistinct());
});
