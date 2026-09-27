import { describe, it } from "vitest";

import {
  assertCreateAcceptsASnakeCaseCode,
  assertS1CreateRefusesASpaceWithTheCatalogMessage,
  assertS2CreateRefusesA33CharacterCode,
  assertS3UpdateRefusesABodyNamingCode,
  assertS4UpdateAcceptsALabelAlone,
  assertS5CreateRefusesANegativeSortOrder,
  assertS6CreateRefusesAFractionalSortOrder,
  assertS7bCreateRefusesAHyphenatedCode,
  assertS7CreateRefusesAnUpperCaseCode,
} from "./location-types.schema.spec";

/**
 * `F4.162` — Vitest entry point for the location-type request bodies.
 * Assertions live in the sibling `.spec` (§4.6).
 */
describe("F4.162 — location-type request bodies", () => {
  it("S1 refuses a code with a space, with the catalog message", () => {
    assertS1CreateRefusesASpaceWithTheCatalogMessage();
  });

  it("S2 refuses a 33-character code", () => {
    assertS2CreateRefusesA33CharacterCode();
  });

  it("S3 refuses a PATCH body naming code", () => {
    assertS3UpdateRefusesABodyNamingCode();
  });

  it("S4 accepts a PATCH body with a label alone", () => {
    assertS4UpdateAcceptsALabelAlone();
  });

  it("S5 refuses a negative sort order", () => {
    assertS5CreateRefusesANegativeSortOrder();
  });

  it("S6 refuses a fractional sort order", () => {
    assertS6CreateRefusesAFractionalSortOrder();
  });

  it("S7 refuses an upper-case code", () => {
    assertS7CreateRefusesAnUpperCaseCode();
  });

  it("S7b refuses a hyphenated code", () => {
    assertS7bCreateRefusesAHyphenatedCode();
  });

  it("accepts a lower snake_case code (positive control)", () => {
    assertCreateAcceptsASnakeCaseCode();
  });
});
