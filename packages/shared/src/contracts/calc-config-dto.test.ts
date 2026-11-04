import { describe, it } from "vitest";

import {
  assertAListWithoutModeFailsToParse,
  assertANullTemplatePointIdParses,
  assertAnEmptyStandaloneListParses,
  assertAnItemWithoutKindFailsToParse,
} from "./calc-config-dto.spec";

/** `F4.311` PR 1 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 — the calc config DTO says which kind it served (ADR 0109 decision 4)", () => {
  it("refuses an item without kind", () => {
    assertAnItemWithoutKindFailsToParse();
  });

  it("accepts templatePointId: null on a standalone item", () => {
    assertANullTemplatePointIdParses();
  });

  it("refuses a list without mode", () => {
    assertAListWithoutModeFailsToParse();
  });

  it("accepts an empty standalone list", () => {
    assertAnEmptyStandaloneListParses();
  });
});
