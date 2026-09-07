import {
  assetInstantiationResultDtoSchema,
  instantiatedAssetDtoSchema,
} from "./admin";
import { seededRuleDtoSchema, seededRuleValuesSchema } from "./seeded-rules";

/**
 * `E2.4` / ADR 0058 decisions 6, 8, 10 — the instantiate result reports what
 * was seeded, and the drift/re-apply DTOs are gated on their own shape.
 *
 * Assertions live here; `admin.test.ts` is the vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectAccepts(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === true, `${message} — expected success, got a refusal`);
}

function expectRejects(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown,
  message: string,
): void {
  assert(schema.safeParse(value).success === false, `${message} — expected a refusal, got success`);
}

const validAsset = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "CR-BATT-1",
  name: "Battery Charger 1",
  locationId: "22222222-2222-4222-8222-222222222222",
  rtuId: null,
  pointCount: 3,
  skippedPoints: [],
  seededRules: ["CR_BATT_1_TEMP_WARNING"],
};

const validResult = {
  templateId: "33333333-3333-4333-8333-333333333333",
  templateCode: "battery-charger",
  templateVersion: 1,
  locationId: "22222222-2222-4222-8222-222222222222",
  rtuId: null,
  sourceKind: "unmapped",
  assets: [validAsset],
  assetCount: 1,
  pointCount: 3,
  ruleCount: 1,
  disabledRuleCount: 0,
};

/** `assetInstantiationResultDtoSchema` REJECTS a payload missing either new field. */
export function runAssetInstantiationResultSeededRulesTests(): void {
  expectAccepts(assetInstantiationResultDtoSchema, validResult, "a full, well-formed result");

  const { ruleCount: _ruleCount, ...withoutRuleCount } = validResult;
  expectRejects(
    assetInstantiationResultDtoSchema,
    withoutRuleCount,
    "a result missing ruleCount",
  );

  const { skippedPoints: _skipped, seededRules: _seededRules, ...assetWithoutSeededRules } =
    validAsset;
  expectRejects(
    assetInstantiationResultDtoSchema,
    { ...validResult, assets: [{ ...assetWithoutSeededRules, skippedPoints: [] }] },
    "an asset entry missing seededRules",
  );

  expectAccepts(instantiatedAssetDtoSchema, validAsset, "an asset entry with seededRules");
}

const validValues = {
  operator: "gte",
  thresholdValue: 60,
  severity: "warning",
  category: "safety",
  message: "Battery temperature high",
};

const validSeededRule = {
  ruleId: "44444444-4444-4444-8444-444444444444",
  ruleCode: "CR_BATT_1_TEMP_WARNING",
  enabled: true,
  assetId: "11111111-1111-4111-8111-111111111111",
  assetCode: "CR-BATT-1",
  assetName: "Battery Charger 1",
  locationId: "22222222-2222-4222-8222-222222222222",
  sourceTemplateId: "33333333-3333-4333-8333-333333333333",
  sourceTemplateVersion: 1,
  sourceAlarmCode: "TEMP_WARNING",
  live: validValues,
  seededBaseline: validValues,
  current: validValues,
  verdict: "in_sync",
};

/** `seededRuleDtoSchema` rejects an unknown `verdict` value. */
export function runSeededRuleDriftVerdictTests(): void {
  expectAccepts(seededRuleDtoSchema, validSeededRule, "a well-formed seeded rule row");
  expectRejects(
    seededRuleDtoSchema,
    { ...validSeededRule, verdict: "drifted" },
    "an unknown verdict value",
  );
  expectAccepts(
    seededRuleDtoSchema,
    { ...validSeededRule, current: null },
    "current null — the alarm code no longer exists in the published version",
  );
}

/**
 * `seededRuleValuesSchema` accepts an all-null operator/threshold pair — a
 * philosophy row's baseline (ADR 0058 decision 3).
 */
export function runSeededRuleValuesPhilosophyRowTests(): void {
  expectAccepts(
    seededRuleValuesSchema,
    {
      operator: null,
      thresholdValue: null,
      severity: "warning",
      category: "safety",
      message: "Inspect for corrosion",
    },
    "a philosophy row's all-null operator/threshold baseline",
  );
  expectRejects(
    seededRuleValuesSchema,
    { operator: null, thresholdValue: null, severity: null, category: "safety" },
    "message is required",
  );
}
