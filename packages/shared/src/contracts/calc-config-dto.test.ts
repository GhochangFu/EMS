import { describe, it } from "vitest";

import {
  assertAListWithoutModeFailsToParse,
  assertAnItemWithARunParses,
  assertAnItemWithoutBackfillFailsToParse,
  assertARunWithAnUnknownStatusFailsToParse,
  assertTheOverrideBodyAcceptsBackfillDays,
  assertTheOverrideBodyRefuses32BackfillDays,
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

describe("F4.311 PR 5b — the item carries its latest backfill run (ADR 0109 decision 7)", () => {
  it("refuses an item without backfill", assertAnItemWithoutBackfillFailsToParse);
  it("accepts an item carrying a run", assertAnItemWithARunParses);
  it("refuses a run status outside the vocabulary", assertARunWithAnUnknownStatusFailsToParse);
  it("accepts backfillDays 31 on the override PUT (owner ruling 1)", assertTheOverrideBodyAcceptsBackfillDays);
  it("refuses backfillDays 32 on the override PUT", assertTheOverrideBodyRefuses32BackfillDays);
});
