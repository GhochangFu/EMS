import {
  adminAssetGroupMemberDtoSchema,
  adminAssetPointDtoSchema,
  adminLocationDtoSchema,
  calcParameterDtoSchema,
} from "./admin";
import { assetInstantiationResultDtoSchema, instantiatedAssetDtoSchema } from "./asset-templates";
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
  dashboards: [],
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
  dashboardCount: 0,
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

/** `F3.2` / ADR 0067 decision 5 — `assetInstantiationResultDtoSchema` gains
 * `dashboardCount` and `instantiatedAssetDtoSchema` gains `dashboards`; both
 * REJECT a payload missing the new field. */
export function runAssetInstantiationResultDashboardFieldsTests(): void {
  expectAccepts(
    assetInstantiationResultDtoSchema,
    validResult,
    "a full result carrying dashboardCount",
  );

  const { dashboardCount: _dashboardCount, ...withoutDashboardCount } = validResult;
  expectRejects(
    assetInstantiationResultDtoSchema,
    withoutDashboardCount,
    "a result missing dashboardCount",
  );

  const { dashboards: _dashboards, ...assetWithoutDashboards } = validAsset;
  expectRejects(
    assetInstantiationResultDtoSchema,
    { ...validResult, assets: [assetWithoutDashboards] },
    "an asset entry missing dashboards",
  );

  expectAccepts(instantiatedAssetDtoSchema, validAsset, "an asset entry carrying dashboards: []");
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

const validLocation = {
  id: "55555555-5555-4555-8555-555555555555",
  organizationId: "66666666-6666-4666-8666-666666666666",
  organizationCode: "PHEWB",
  organizationName: "PHE West Bengal",
  code: "LOTAPATA",
  slug: "lotapata",
  name: "Lotapata",
  type: "pump_station",
  typeLabel: "Pump station",
  parentId: null,
  province: null,
  capital: null,
  timezone: null,
  floorAreaM2: null,
  latitude: 24.1,
  longitude: 88.4,
  active: true,
  meta: null,
  createdAt: "2026-09-26T00:00:00.000Z",
  updatedAt: "2026-09-26T00:00:00.000Z",
};

/**
 * `F4.157` (ADR 0077 D1) — `type` is no longer a closed three-value enum;
 * `pump_station`, the fourth `bms.location_types` row the migration adds,
 * must parse. C2's mutation ("restore the enum") is what this pins against.
 */
export function runAdminLocationDtoAcceptsPumpStationTest(): void {
  expectAccepts(adminLocationDtoSchema, validLocation, "an admin location row with type: pump_station");
}

/**
 * `F4.162` C10 (ADR 0077 Amendment 1, OQ2, plan D3) — `typeLabel` is
 * required: a row missing it must be refused, not silently accepted with a
 * `typeLabel: undefined`. Mutation: make the field `.optional()`.
 */
export function runAdminLocationDtoRequiresTypeLabelTest(): void {
  expectAccepts(adminLocationDtoSchema, validLocation, "a full row carrying typeLabel");

  const { typeLabel: _typeLabel, ...withoutTypeLabel } = validLocation;
  expectRejects(adminLocationDtoSchema, withoutTypeLabel, "a row missing typeLabel");
}

/**
 * `F2.10` (ADR 0098) — `parentId` is required and nullable: null for a root
 * (or a parent the caller cannot read), a string for a child. Mutation: make
 * the field `.optional()`, or drop `.nullable()`.
 */
export function runAdminLocationDtoParentIdTests(): void {
  expectAccepts(adminLocationDtoSchema, validLocation, "a root row with parentId: null");
  expectAccepts(
    adminLocationDtoSchema,
    { ...validLocation, parentId: "77777777-7777-4777-8777-777777777777" },
    "a child row with a string parentId",
  );

  const { parentId: _parentId, ...withoutParentId } = validLocation;
  expectRejects(adminLocationDtoSchema, withoutParentId, "a row missing parentId");
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

// --- `F4.316` PR 5 / ADR 0111 — the admin rows name the asset's RTU and location ----------

const validAssetPoint = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  assetCode: "PHE-MFM-000000003",
  assetRtuName: "Lotapata I",
  assetLocationName: "Lotapata",
  assetName: "Main flow meter",
  locationId: "33333333-3333-4333-8333-333333333333",
  locationName: "Lotapata",
  pointKey: "flow",
  sourceDataKey: "PHE_MFM_3_FLOW",
  sensorCode: null,
  unit: "m3/h",
  active: true,
  sourceKind: "measured",
  rtuId: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-11-06T00:00:00.000Z",
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
  templateDefaults: null,
};

const validGroupMember = {
  membershipId: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  assetCode: "WC-CHW-01",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  assetName: "Chiller 1",
  assetDomain: "hvac",
  role: null,
  roleLabel: null,
};

const validCalcParameter = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  key: "tariff_kwh",
  locationId: null,
  assetId: "33333333-3333-4333-8333-333333333333",
  locationName: null,
  assetCode: "WC-CHW-01",
  assetRtuName: "RTU 1",
  assetLocationName: "Plant A",
  value: 7.5,
  effectiveFrom: "2026-11-06T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "2026-11-06T00:00:00.000Z",
  updatedAt: "2026-11-06T00:00:00.000Z",
};

type LabelSchema = { safeParse: (v: unknown) => { success: boolean } };

function withoutKey(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...row };
  delete copy[key];
  return copy;
}

/** A row missing `assetRtuName` is refused: the field is required, not optional. */
function refusesWithoutRtuName(schema: LabelSchema, row: Record<string, unknown>, name: string): void {
  expectAccepts(schema, row, `${name}: a well-formed row`);
  expectRejects(schema, withoutKey(row, "assetRtuName"), `${name}: a row missing assetRtuName`);
}

/** A row missing `assetLocationName` is refused: the field is required, not optional. */
function refusesWithoutLocationName(schema: LabelSchema, row: Record<string, unknown>, name: string): void {
  expectRejects(schema, withoutKey(row, "assetLocationName"), `${name}: a row missing assetLocationName`);
}

/** The RTU-less twin: `assetRtuName: null` beside a location name parses. */
function acceptsTheRtuLessTwin(schema: LabelSchema, row: Record<string, unknown>, name: string): void {
  expectAccepts(schema, { ...row, assetRtuName: null }, `${name}: an asset with no RTU`);
}

export function runAdminAssetPointRefusesWithoutRtuNameTest(): void {
  refusesWithoutRtuName(adminAssetPointDtoSchema, validAssetPoint, "adminAssetPointDto");
}
export function runAdminAssetPointRefusesWithoutLocationNameTest(): void {
  refusesWithoutLocationName(adminAssetPointDtoSchema, validAssetPoint, "adminAssetPointDto");
}
export function runAdminAssetPointAcceptsRtuLessTwinTest(): void {
  acceptsTheRtuLessTwin(adminAssetPointDtoSchema, validAssetPoint, "adminAssetPointDto");
}

export function runAdminAssetGroupMemberRefusesWithoutRtuNameTest(): void {
  refusesWithoutRtuName(adminAssetGroupMemberDtoSchema, validGroupMember, "adminAssetGroupMemberDto");
}
export function runAdminAssetGroupMemberRefusesWithoutLocationNameTest(): void {
  refusesWithoutLocationName(adminAssetGroupMemberDtoSchema, validGroupMember, "adminAssetGroupMemberDto");
}
export function runAdminAssetGroupMemberAcceptsRtuLessTwinTest(): void {
  acceptsTheRtuLessTwin(adminAssetGroupMemberDtoSchema, validGroupMember, "adminAssetGroupMemberDto");
}

export function runCalcParameterRefusesWithoutRtuNameTest(): void {
  refusesWithoutRtuName(calcParameterDtoSchema, validCalcParameter, "calcParameterDto");
}
export function runCalcParameterRefusesWithoutLocationNameTest(): void {
  refusesWithoutLocationName(calcParameterDtoSchema, validCalcParameter, "calcParameterDto");
}
/** An organization- or location-scoped parameter names no asset: all three label fields null. */
export function runCalcParameterAcceptsNoAssetTest(): void {
  expectAccepts(
    calcParameterDtoSchema,
    { ...validCalcParameter, assetId: null, assetCode: null, assetRtuName: null, assetLocationName: null },
    "calcParameterDto: an organization-scoped row",
  );
}
