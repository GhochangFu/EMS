import { expect } from "vitest";

import {
  TEMPLATE_ADOPTION_MAX_ASSETS,
  adoptAssetsBodySchema,
  templateAdoptionAssetPlanDtoSchema,
  templateAdoptionPreviewResponseSchema,
  templateAdoptionRefusalReasonSchema,
} from "./template-adoption";

/**
 * `F4.312` (ADR 0109 Amendment 1) — the adoption body and vocabulary. One
 * claim per function; the `.test.ts` sibling runs them. Each names the
 * mutation it catches.
 */

const assetIds = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

/** Catches a restated bound drifting from the calc batch's 25 (decision 4). */
export function theCapIsTheCalcBatchCap(): void {
  expect(TEMPLATE_ADOPTION_MAX_ASSETS).toBe(25);
}

/** Catches `.max(TEMPLATE_ADOPTION_MAX_ASSETS)` lowered: 25 parses. */
export function aBatchOfTwentyFiveParses(): void {
  expect(adoptAssetsBodySchema.safeParse({ assetIds: assetIds(25) }).success).toBe(true);
}

/** Catches `.max(...)` dropped or raised: 26 is refused. */
export function aBatchOfTwentySixIsRefused(): void {
  expect(adoptAssetsBodySchema.safeParse({ assetIds: assetIds(26) }).success).toBe(false);
}

/** Catches `.min(1)` dropped: an empty batch is refused. */
export function anEmptyBatchIsRefused(): void {
  expect(adoptAssetsBodySchema.safeParse({ assetIds: [] }).success).toBe(false);
}

/** Catches the duplicate refine removed: a repeated id is refused. */
export function aRepeatedIdIsRefused(): void {
  const [id] = assetIds(1);
  expect(adoptAssetsBodySchema.safeParse({ assetIds: [id, id] }).success).toBe(false);
}

/** Catches `.uuid()` dropped: a non-uuid id is refused. */
export function aNonUuidIdIsRefused(): void {
  expect(adoptAssetsBodySchema.safeParse({ assetIds: ["PHE-MFM-01"] }).success).toBe(false);
}

/** Catches `.strict()` dropped: a plan echoed back in the body is refused (owner ruling 1). */
export function anEchoedPlanIsRefused(): void {
  expect(adoptAssetsBodySchema.safeParse({ assetIds: assetIds(1), planHash: "x" }).success).toBe(
    false,
  );
}

/** Catches a reason dropped from the vocabulary: plan 1.1's twelve plus `dashboard_slug_taken`. */
export function theVocabularyHoldsTheThirteenReasons(): void {
  expect([...templateAdoptionRefusalReasonSchema.options].sort()).toEqual(
    [
      "already_pinned",
      "organization_mismatch",
      "domain_mismatch",
      "standalone_calc_not_declared",
      "unit_mismatch",
      "derived_key_held_by_mapping",
      "point_key_already_mapped",
      "unresolvable_source_data_key",
      "source_key_already_used",
      "calc_override_invalid_on_target",
      "metadata_override_invalid_on_target",
      "rule_code_taken",
      "dashboard_slug_taken",
    ].sort(),
  );
}

/** Catches `refusalCount` dropped from the preview: the true total is part of the contract. */
export function aPreviewWithoutTheRefusalCountIsRefused(): void {
  const preview = {
    templateId: "t",
    templateCode: "PUMP",
    templateVersion: 1,
    assets: [],
    refusals: [],
    canApply: true,
  };
  expect(templateAdoptionPreviewResponseSchema.safeParse(preview).success).toBe(false);
}

/** Catches `inheritsDefaults` dropped from the per-asset plan (review item 1). */
export function aPlanWithoutInheritedDefaultsIsRefused(): void {
  const plan = {
    assetId: "a",
    assetCode: "PUMP-01",
    assetRtuName: null,
    assetLocationName: null,
    assetName: "Pump",
    kept: [],
    added: [],
    converted: [],
    skipped: [],
  };
  expect(templateAdoptionAssetPlanDtoSchema.safeParse(plan).success).toBe(false);
}

const planRow = {
  assetId: "a",
  assetCode: "PUMP-01",
  assetRtuName: "Lotapata I",
  assetLocationName: "Lotapata",
  assetName: "Pump",
  kept: [],
  added: [],
  converted: [],
  skipped: [],
  inheritsDefaults: [],
};

/** Catches the F4.316 names optional rather than required-nullable: a producer that forgets one still parses. */
export function aPlanWithoutTheRtuNameIsRefused(): void {
  const { assetRtuName: _omitted, ...without } = planRow;
  expect(templateAdoptionAssetPlanDtoSchema.safeParse(without).success).toBe(false);
}

/** Same, for the location name. */
export function aPlanWithoutTheLocationNameIsRefused(): void {
  const { assetLocationName: _omitted, ...without } = planRow;
  expect(templateAdoptionAssetPlanDtoSchema.safeParse(without).success).toBe(false);
}

/** Catches the names non-nullable: an RTU-less asset has `assetRtuName: null`. */
export function aPlanWithNullNamesParses(): void {
  expect(
    templateAdoptionAssetPlanDtoSchema.safeParse({ ...planRow, assetRtuName: null, assetLocationName: null }).success,
  ).toBe(true);
}
