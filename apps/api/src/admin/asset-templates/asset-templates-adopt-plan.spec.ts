import { expect } from "vitest";

import type { TemplateAdoptionRefusalDto } from "@bms/shared";

import {
  alreadyPinnedMessage,
  domainMismatchMessage,
  organizationMismatchMessage,
} from "./asset-templates-adopt-messages";
import {
  planAdoption,
  type AdoptionAsset,
  type AdoptionExistingRow,
  type PlannedAdoption,
} from "./asset-templates-adopt-plan";
import type { StoredTemplatePoint } from "./template-version-delta";

/**
 * `F4.312` (ADR 0109 Amendment 1; plan task 1.5) — the pure adoption planner,
 * one rule per function. The `.test.ts` sibling runs them, one claim per `it`.
 * Each docblock names the mutation of `asset-templates-adopt-plan.ts` that
 * reddens it.
 */

const ORG = "org-1";
const TARGET = { id: "tpl-1", code: "PUMP", version: 3, organizationId: ORG, domain: "water" };

function point(pointKey: string, overrides: Partial<StoredTemplatePoint> = {}): StoredTemplatePoint {
  return {
    pointKey,
    kind: "measured",
    sourceDataKeyPattern: `{asset_code}/${pointKey}`,
    required: true,
    unit: null,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    minCoverageRatio: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

const derived = (pointKey: string, overrides: Partial<StoredTemplatePoint> = {}): StoredTemplatePoint =>
  point(pointKey, {
    kind: "derived",
    sourceDataKeyPattern: null,
    formula: "{KW} * 2",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 60,
    maxInputAgeSeconds: 300,
    ...overrides,
  });

function row(pointKey: string, overrides: Partial<AdoptionExistingRow> = {}): AdoptionExistingRow {
  return {
    pointKey,
    sourceKind: "measured",
    sourceDataKey: `RTU/${pointKey}`,
    unit: null,
    formula: null,
    formulaDialect: null,
    calcTrigger: null,
    calcIntervalSeconds: null,
    maxInputAgeSeconds: null,
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
    qualityPolicy: null,
    ...overrides,
  };
}

/** A standalone point states every calc column but the staleness bound, which the version sets. */
const computed = (pointKey: string, unit: string | null = null): AdoptionExistingRow =>
  row(pointKey, {
    sourceKind: "computed",
    sourceDataKey: `computed:${pointKey}`,
    unit,
    formula: "{KVA} + 1",
    formulaDialect: "bms-calc-v1",
    calcTrigger: "scheduled",
    calcIntervalSeconds: 120,
  });

function asset(overrides: Partial<AdoptionAsset> = {}): AdoptionAsset {
  return {
    id: "asset-1",
    code: "PHE-PUMP-01",
    name: "Pump 1",
    rtuName: "Lotapata I",
    locationName: "Lotapata",
    organizationId: ORG,
    domain: "water",
    templateId: null,
    sourceDataKeyVars: null,
    ...overrides,
  };
}

type Run = { plans: PlannedAdoption[]; refusals: TemplateAdoptionRefusalDto[] };

function run(
  points: StoredTemplatePoint[],
  rows: AdoptionExistingRow[],
  options: { asset?: Partial<AdoptionAsset>; units?: Record<string, string | null> } = {},
): Run {
  const refusals: TemplateAdoptionRefusalDto[] = [];
  const plans = planAdoption({
    target: TARGET,
    points,
    catalogUnits: new Map(Object.entries(options.units ?? {})),
    assets: [{ asset: asset(options.asset), rows }],
    refuse: (refusal) => refusals.push(refusal),
  });
  return { plans, refusals };
}

const reasons = (r: Run): string[] => r.refusals.map((refusal) => refusal.reason);

/** Mutation: `assetRtuName`/`assetLocationName` dropped from the plan dto → the label cannot name the RTU. */
export function thePlanCarriesTheRtuAndLocationNames(): void {
  const r = run([point("KW")], []);
  expect([r.plans[0]?.dto.assetRtuName, r.plans[0]?.dto.assetLocationName]).toEqual(["Lotapata I", "Lotapata"]);
}

/** An RTU-less asset keeps `assetRtuName: null` and still names its location. */
export function anRtuLessAssetCarriesNullAndItsLocation(): void {
  const r = run([point("KW")], [], { asset: { rtuName: null } });
  expect([r.plans[0]?.dto.assetRtuName, r.plans[0]?.dto.assetLocationName]).toEqual([null, "Lotapata"]);
}

/** Mutation: the `templateId !== null` check removed → an already-pinned asset is planned. */
export function aPinnedAssetIsRefused(): void {
  const r = run([point("KW")], [], { asset: { templateId: "tpl-0" } });
  expect(reasons(r)).toEqual(["already_pinned"]);
}

/** Mutation: the early `return` after a whole-asset refusal dropped → its points are planned too. */
export function aPinnedAssetGetsNoPointPlan(): void {
  const r = run([point("KW")], [], { asset: { templateId: "tpl-0" } });
  expect(r.plans[0]?.dto.added).toEqual([]);
}

/** Mutation: `eligible: false` on a whole-asset refusal flipped → the service gates a refused asset. */
export function aPinnedAssetIsNotEligible(): void {
  expect(run([point("KW")], [], { asset: { templateId: "tpl-0" } }).plans[0]?.eligible).toBe(false);
}

/** Mutation: the organization comparison removed (A1). */
export function anAssetOfAnotherOrganizationIsRefused(): void {
  expect(reasons(run([point("KW")], [], { asset: { organizationId: "org-2" } }))).toEqual([
    "organization_mismatch",
  ]);
}

/** `F4.315` PR A: the route's pinned sentence is the shared builder's, the copilot's text (Amendment 14 decision 2). */
export function thePinnedSentenceIsTheSharedOne(): void {
  const r = run([point("KW")], [], { asset: { templateId: "tpl-0" } });
  expect(r.refusals[0]?.message).toBe(alreadyPinnedMessage(asset(), TARGET));
}

/** `F4.315` PR A: the route's organization sentence is the shared builder's. */
export function theOrganizationSentenceIsTheSharedOne(): void {
  const r = run([point("KW")], [], { asset: { organizationId: "org-2" } });
  expect(r.refusals[0]?.message).toBe(organizationMismatchMessage(asset(), TARGET));
}

/** `F4.315` PR A: the route's domain sentence is the shared builder's. */
export function theDomainSentenceIsTheSharedOne(): void {
  const r = run([point("KW")], [], { asset: { domain: "electrical" } });
  expect(r.refusals[0]?.message).toBe(domainMismatchMessage(asset({ domain: "electrical" }), TARGET));
}

/** Mutation: the domain comparison removed (A1). */
export function anAssetOfAnotherDomainIsRefused(): void {
  expect(reasons(run([point("KW")], [], { asset: { domain: "electrical" } }))).toEqual([
    "domain_mismatch",
  ]);
}

/** Mutation: the measured branch's computed-row check removed → the row is kept (owner ruling 5). */
export function aComputedRowOnAMeasuredKeyIsRefused(): void {
  expect(reasons(run([point("KW")], [computed("KW")]))).toEqual(["point_key_already_mapped"]);
}

/** Mutation: a measured row on a declared key added again instead of kept (decision 1). */
export function aMeasuredRowOnAMeasuredKeyIsKept(): void {
  const r = run([point("KW")], [row("KW")]);
  expect(r.plans[0]?.dto.kept).toEqual(["KW"]);
}

/** Mutation: a kept row also listed as an addition → a duplicate insert. */
export function aKeptRowIsNotAdded(): void {
  expect(run([point("KW")], [row("KW")]).plans[0]?.dto.added).toEqual([]);
}

/** Mutation: `checkUnit` skipped for a kept row (A8). */
export function aKeptRowInAnotherUnitIsRefused(): void {
  expect(reasons(run([point("KW", { unit: "kW" })], [row("KW", { unit: "W" })]))).toEqual([
    "unit_mismatch",
  ]);
}

/** Mutation: `row.unit === null` dropped from the guard → a blank unit refuses (owner ruling 3). */
export function aBlankRowUnitIsNotAMismatch(): void {
  expect(reasons(run([point("KW", { unit: "kW" })], [row("KW")]))).toEqual([]);
}

/** Mutation: the catalog fallback dropped from the version's unit → the mismatch is missed. */
export function theCatalogUnitStandsInForATemplateWithNone(): void {
  expect(reasons(run([point("KW")], [row("KW", { unit: "W" })], { units: { KW: "kW" } }))).toEqual([
    "unit_mismatch",
  ]);
}

/** Mutation: the equality short-circuit inverted → an equal unit refuses. */
export function anEqualUnitIsNotAMismatch(): void {
  expect(reasons(run([point("KW", { unit: "kW" })], [row("KW", { unit: "kW" })]))).toEqual([]);
}

/** Mutation: the derived+computed branch refuses or keeps instead of converting (ruling 8). */
export function aComputedRowOnADerivedKeyIsConverted(): void {
  expect(run([derived("KW_X2")], [computed("KW_X2")]).plans[0]?.dto.converted).toEqual(["KW_X2"]);
}

/** Mutation: `checkUnit` skipped for a converted row (A8 applies to every same-key pair). */
export function aConvertedRowInAnotherUnitIsRefused(): void {
  expect(reasons(run([derived("KW_X2", { unit: "kW" })], [computed("KW_X2", "W")]))).toEqual([
    "unit_mismatch",
  ]);
}

/** Mutation: the derived+other branch converts a mapping (decision 2). */
export function aMappingOnADerivedKeyIsRefused(): void {
  expect(reasons(run([derived("KW_X2")], [row("KW_X2", { sourceKind: "manual" })]))).toEqual([
    "derived_key_held_by_mapping",
  ]);
}

/** Mutation: a derived point the asset lacks is added as a row → derived points need none. */
export function aMissingDerivedPointWritesNothing(): void {
  const r = run([derived("KW_X2")], []);
  const dto = r.plans[0]?.dto;
  expect([dto?.added, dto?.converted, dto?.kept, dto?.skipped, reasons(r)]).toEqual([[], [], [], [], []]);
}

/** Mutation: the addition's key or unit resolved differently from migrate/instantiate (A3). */
export function aMissingMeasuredPointIsAdded(): void {
  expect(run([point("KW")], [], { units: { KW: "kW" } }).plans[0]?.dto.added).toEqual([
    { pointKey: "KW", sourceDataKey: "PHE-PUMP-01/KW", unit: "kW" },
  ]);
}

/** Mutation: `storedVars` not passed to the resolver → a `{panel}` pattern cannot resolve. */
export function anAdditionResolvesFromTheStoredVariables(): void {
  const r = run([point("KW", { sourceDataKeyPattern: "{panel}/KW" })], [], {
    asset: { sourceDataKeyVars: { panel: "MCC1" } },
  });
  expect(r.plans[0]?.dto.added[0]?.sourceDataKey).toBe("MCC1/KW");
}

/** Mutation: the `required` branch skips instead of refusing. */
export function anUnresolvableRequiredPointIsRefused(): void {
  expect(reasons(run([point("KW", { sourceDataKeyPattern: "{panel}/KW" })], []))).toEqual([
    "unresolvable_source_data_key",
  ]);
}

/** Mutation: the optional branch refuses instead of skipping. */
export function anUnresolvableOptionalPointIsSkipped(): void {
  const r = run([point("KW", { sourceDataKeyPattern: null, required: false })], []);
  expect([r.plans[0]?.dto.skipped, reasons(r)]).toEqual([["KW"], []]);
}

/** Mutation: the 128-character check removed → the insert fails on the column. */
export function anOverLongSourceKeyIsRefused(): void {
  const r = run([point("KW", { sourceDataKeyPattern: `${"X".repeat(130)}/{asset_code}` })], []);
  expect(reasons(r)).toEqual(["unresolvable_source_data_key"]);
}

/** Mutation: the existing-holder check removed → the source-key index raises inside the transaction. */
export function aSourceKeyHeldByAnExistingRowIsRefused(): void {
  const held = row("OTHER", { sourceDataKey: "PHE-PUMP-01/KW" });
  expect(reasons(run([point("KW")], [held]))).toEqual(["source_key_already_used"]);
}

/** Mutation: the second-addition check removed → two new rows on one source key. */
export function twoAdditionsOnOneSourceKeyAreRefused(): void {
  const r = run(
    [point("KW", { sourceDataKeyPattern: "SAME" }), point("KVA", { sourceDataKeyPattern: "SAME" })],
    [],
  );
  expect(reasons(r)).toEqual(["source_key_already_used"]);
}

/** Mutation: an undeclared computed row kept instead of refused (A4). */
export function anUndeclaredStandalonePointIsRefused(): void {
  expect(reasons(run([point("KW")], [row("KW"), computed("EFF")]))).toEqual([
    "standalone_calc_not_declared",
  ]);
}

/** Mutation: an undeclared non-computed row dropped from `kept` (A2). */
export function anUndeclaredMappingIsKept(): void {
  expect(run([point("KW")], [row("KW"), row("EXTRA")]).plans[0]?.dto.kept).toEqual(["KW", "EXTRA"]);
}

/** Mutation: a refusal built without the asset id — the DTO fields are how the UI groups refusals. */
export function aRefusalCarriesTheAssetFields(): void {
  const [refusal] = run([point("KW")], [computed("KW")]).refusals;
  expect([refusal?.assetId, refusal?.assetCode, refusal?.pointKey]).toEqual([
    "asset-1",
    "PHE-PUMP-01",
    "KW",
  ]);
}

/** Mutation: a message that drops the asset code or the point key (decision 2: each refusal names both). */
export function everyPointRefusalNamesTheAssetCodeAndThePointKey(): void {
  const r = run(
    [
      point("A"),
      point("B", { unit: "kW" }),
      derived("C"),
      point("D", { sourceDataKeyPattern: "{panel}" }),
      point("E", { sourceDataKeyPattern: "RTU/HELD" }),
    ],
    [
      computed("A"),
      row("B", { unit: "W" }),
      row("C", { sourceKind: "unmapped" }),
      row("HOLDER", { sourceDataKey: "RTU/HELD" }),
      computed("F"),
    ],
  );
  const unnamed = r.refusals.filter(
    (refusal) =>
      !refusal.message.includes("PHE-PUMP-01") || !refusal.message.includes(`"${refusal.pointKey}"`),
  );
  // The count rides with the list, so a fixture that stops producing six refusals cannot pass vacuously.
  expect([r.refusals.length, unnamed]).toEqual([6, []]);
}

/** Review item 3 / ruling 3. Mutation: the trim dropped → a whitespace row unit refuses. */
export function aWhitespaceRowUnitIsBlank(): void {
  expect(reasons(run([point("KW", { unit: "kW" })], [row("KW", { unit: "  " })]))).toEqual([]);
}

/** Review item 3. Mutation: the version side not blanked → an empty template unit refuses. */
export function anEmptyVersionUnitIsBlank(): void {
  expect(reasons(run([point("KW", { unit: "" })], [row("KW", { unit: "W" })]))).toEqual([]);
}

/** Review item 1. Mutation: `reportInherited` not called for a kept row. */
export function aKeptRowListsTheMetadataItInherits(): void {
  const r = run([point("KW", { engMax: 100, qualityPolicy: "reject" })], [row("KW", { engMin: 0 })]);
  expect(r.plans[0]?.dto.inheritsDefaults).toEqual([{ pointKey: "KW", fields: ["engMax", "qualityPolicy"] }]);
}

/** Review item 1. Mutation: the row's own value ignored → a field the row sets is listed. */
export function aFieldTheRowSetsIsNotInherited(): void {
  const r = run([point("KW", { engMax: 100 })], [row("KW", { engMax: 90 })]);
  expect(r.plans[0]?.dto.inheritsDefaults).toEqual([]);
}

/** Review item 1. Mutation: the calc columns not compared for a converted row. */
export function aConvertedRowListsTheCalcColumnsItInherits(): void {
  const r = run([derived("KW_X2")], [computed("KW_X2")]);
  expect(r.plans[0]?.dto.inheritsDefaults).toEqual([{ pointKey: "KW_X2", fields: ["maxInputAgeSeconds"] }]);
}

/** Review item 10. Mutation: `operation: "adopt"` dropped → the sentence tells the operator to rebuild. */
export function anUnresolvableRefusalGivesTheAdoptRemedy(): void {
  const [refusal] = run([point("KW", { sourceDataKeyPattern: "{panel}/KW" })], []).refusals;
  expect([
    refusal?.message.includes("adoption cannot resolve {panel}"),
    refusal?.message.includes('Add "KW" on the asset first'),
    /rebuild|migrat/i.test(refusal?.message ?? ""),
  ]).toEqual([true, true, false]);
}
