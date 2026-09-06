import { QUALITY_POLICIES } from "../ingest";
import {
  adminAssetPointDtoSchema,
  adminTemplatePointDtoSchema,
  stockTemplatePointDtoSchema,
} from "./admin";
import {
  POINT_METADATA_FIELDS,
  pointMetadataFieldsSchema,
  pointMetadataShape,
  qualityPolicySchema,
} from "./point-metadata";

/**
 * `F2.7` / ADR 0056 decisions 1 and 3 — the five point-metadata fields on the
 * read side, declared once in `point-metadata.ts` and spread into the DTOs.
 *
 * Assertions live here; `point-metadata.test.ts` is the vitest entry point
 * (ADR 0014). Everything in this file is a plain object and needs no connection.
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

const FIVE_NULL = {
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

const FIVE_SET = {
  scaleMultiplier: 0.1,
  scaleOffset: -40,
  engMin: 0,
  engMax: 100,
  qualityPolicy: "accept_bad",
};

const assetPoint = {
  id: "11111111-1111-4111-8111-111111111111",
  assetId: "22222222-2222-4222-8222-222222222222",
  assetCode: "TX01",
  assetName: "Transformer 1",
  locationId: null,
  locationName: null,
  pointKey: "kw",
  sourceDataKey: "TX01_KW",
  sensorCode: null,
  unit: "kW",
  active: true,
  sourceKind: "measured",
  // ADR 0018 decision 3 / ADR 0056 Q-H: a measured point names its RTU, and the
  // DTO surfaces it since F2.7 so a wiring PATCH is observable in the response.
  rtuId: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-09-06T00:00:00.000Z",
};

const templatePoint = {
  id: "33333333-3333-4333-8333-333333333333",
  templateId: "44444444-4444-4444-8444-444444444444",
  pointKey: "kw",
  label: null,
  unit: null,
  kind: "measured",
  sourceDataKeyPattern: "{asset_code}_KW",
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  minCoverageRatio: null,
  required: true,
  sortOrder: 0,
  meta: { tier: "core" },
  createdAt: "2026-09-06T00:00:00.000Z",
};

const stockPoint = {
  pointKey: "kw",
  label: null,
  unit: null,
  sourceDataKeyPattern: "{asset_code}_KW",
  formula: null,
  formulaDialect: null,
  kind: "measured",
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
  minCoverageRatio: null,
  required: true,
  sortOrder: 0,
  meta: { tier: "core" },
};

/** The vocabulary is the host's `QUALITY_POLICIES`, not a second list. */
export function runQualityPolicyVocabularyTests(): void {
  assert(
    JSON.stringify(qualityPolicySchema.options) === JSON.stringify(QUALITY_POLICIES),
    `qualityPolicySchema must be built from QUALITY_POLICIES, got ${JSON.stringify(qualityPolicySchema.options)}`,
  );
  assert(
    JSON.stringify(QUALITY_POLICIES) === JSON.stringify(["discard_bad", "accept_bad"]),
    `the policy is two-valued (ADR 0056 Q3), got ${JSON.stringify(QUALITY_POLICIES)}`,
  );
  expectRejects(qualityPolicySchema, "clamp", "an unknown policy is refused");
}

/** The shape names exactly the five fields, and every field is nullable with no bound. */
export function runPointMetadataShapeTests(): void {
  const shapeKeys = Object.keys(pointMetadataShape).sort();
  assert(
    JSON.stringify(shapeKeys) === JSON.stringify([...POINT_METADATA_FIELDS].sort()),
    `POINT_METADATA_FIELDS and pointMetadataShape must name the same five, got ${JSON.stringify(shapeKeys)}`,
  );
  expectAccepts(pointMetadataFieldsSchema, FIVE_NULL, "all five null — inherit / today's behaviour");
  expectAccepts(pointMetadataFieldsSchema, FIVE_SET, "all five set");
  // Read side, no bounds: a schema that rejects a row the database holds lies
  // about the estate. The bounds live on the write side in `apps/api`.
  expectAccepts(pointMetadataFieldsSchema, { ...FIVE_NULL, scaleMultiplier: 0 }, "a zero multiplier reads");
  expectAccepts(
    pointMetadataFieldsSchema,
    { ...FIVE_NULL, engMin: 100, engMax: 0 },
    "an inverted band reads — the CHECK and the merged-pair rule are write-side",
  );
  expectRejects(pointMetadataFieldsSchema, { ...FIVE_NULL, qualityPolicy: "clamp" }, "the enum still binds");
  expectRejects(pointMetadataFieldsSchema, { ...FIVE_NULL, engMax: "100" }, "a string is not a number");
  expectRejects(
    pointMetadataFieldsSchema,
    { scaleMultiplier: null, scaleOffset: null, engMin: null, engMax: null },
    "every one of the five is required on the read side — an absent key is a mapper that forgot one",
  );
}

/** The two row DTOs carry the five as required nullable keys. */
export function runDtoSpreadTests(): void {
  expectAccepts(adminAssetPointDtoSchema, { ...assetPoint, ...FIVE_NULL }, "asset point, five null");
  expectAccepts(adminAssetPointDtoSchema, { ...assetPoint, ...FIVE_SET }, "asset point, five set");
  expectRejects(
    adminAssetPointDtoSchema,
    { ...assetPoint, ...FIVE_NULL, qualityPolicy: "clamp" },
    "asset point refuses an unknown policy",
  );
  expectRejects(adminAssetPointDtoSchema, assetPoint, "asset point without the five is a mapper that forgot them");

  expectAccepts(adminTemplatePointDtoSchema, { ...templatePoint, ...FIVE_NULL }, "template point, five null");
  expectAccepts(adminTemplatePointDtoSchema, { ...templatePoint, ...FIVE_SET }, "template point, five set");
  expectRejects(
    adminTemplatePointDtoSchema,
    { ...templatePoint, ...FIVE_NULL, qualityPolicy: "clamp" },
    "template point refuses an unknown policy",
  );
  expectRejects(adminTemplatePointDtoSchema, templatePoint, "template point without the five is refused");
}

/**
 * The stock write shape carries the five as **optional** nullable keys.
 *
 * Optional, not required, because `apps/api`'s `templatePointBodySchema` is
 * `.strict()` and every catalog entry is parsed through it (the build-time
 * spec and the runtime import both). A required key would force every stock
 * literal to spell five nulls the body schema refuses until Unit C teaches it
 * the five — and `F2.9` correction 14's lesson runs the other way: a required
 * read-side key a literal lacks is a runtime 500 on `GET /stock`.
 */
export function runStockShapeTests(): void {
  expectAccepts(stockTemplatePointDtoSchema, stockPoint, "a stock point that says nothing about metadata");
  expectAccepts(stockTemplatePointDtoSchema, { ...stockPoint, ...FIVE_NULL }, "stock point, five null");
  expectAccepts(stockTemplatePointDtoSchema, { ...stockPoint, ...FIVE_SET }, "stock point, five set");
  expectRejects(
    stockTemplatePointDtoSchema,
    { ...stockPoint, qualityPolicy: "clamp" },
    "stock point refuses an unknown policy",
  );
  expectRejects(
    stockTemplatePointDtoSchema,
    { ...stockPoint, scaleMultiplier: "0.1" },
    "stock point refuses a string where a number is due",
  );
}
