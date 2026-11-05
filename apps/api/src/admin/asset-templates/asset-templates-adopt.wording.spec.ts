import { expect } from "vitest";

import { translateRuleCodeCollision } from "./asset-templates-adopt.service";
import { parseTemplateContentForInstantiate } from "./asset-templates-instantiate-guards";
import { refuseOverridesThatDoNotSurvive } from "./asset-templates-migrate-calc";
import { translateAssetPointInsertUnique } from "./asset-templates-migrate-constraints";
import { refuseMetadataOverridesThatDoNotSurvive } from "./asset-templates-migrate-metadata";
import type { TemplateRow } from "./asset-templates-write-guards";
import type { StoredTemplatePoint } from "./template-version-delta";

/**
 * `F4.312` review item 10 — an adoption's sentences never tell the operator to
 * migrate or rebuild, and never call a standalone point an "override". Each
 * shared helper is driven with `operation: "adopt"`; migrate's own wording is
 * held byte for byte by its existing specs. Each docblock names the mutation.
 * The `.test.ts` sibling runs these (ADR 0014).
 */

const MIGRATE_WORDS = /migrat|rebuild/i;

function stored(pointKey: string, overrides: Partial<StoredTemplatePoint>): StoredTemplatePoint {
  return {
    pointKey,
    kind: "measured",
    sourceDataKeyPattern: null,
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

/** Mutation: the calc gate ignores `operation` → "its calc override … then migrate". */
export async function theCalcGateSpeaksOfAStandalonePoint(): Promise<void> {
  const messages: string[] = [];
  await refuseOverridesThatDoNotSurvive({
    assets: [
      {
        assetId: "a",
        assetCode: "PUMP-01",
        rows: new Map([
          [
            "EFF",
            {
              sourceKind: "computed",
              formula: "{NOPE} + 1",
              formulaDialect: "bms-calc-v1",
              calcTrigger: "scheduled",
              calcIntervalSeconds: 60,
              maxInputAgeSeconds: 300,
            },
          ],
        ]),
      },
    ],
    targetPoints: [
      stored("KW", {}),
      stored("EFF", {
        kind: "derived",
        formula: "{KW} * 2",
        formulaDialect: "bms-calc-v1",
        calcTrigger: "scheduled",
        calcIntervalSeconds: 60,
      }),
    ],
    targetPointIdsByKey: new Map(),
    targetVersion: 2,
    dependencies: { checkCandidates: async () => [] },
    refuse: (refusal) => messages.push(refusal.message),
    operation: "adopt",
  });
  expect([
    messages.length,
    messages.every((m) => m.includes('standalone calculated point "EFF"') && m.endsWith("then adopt.")),
    messages.some((m) => MIGRATE_WORDS.test(m) || m.includes("calc override")),
  ]).toEqual([1, true, false]);
}

/** Mutation: the metadata gate ignores `operation` → "Clear or restate the override … then migrate". */
export function theMetadataGateGivesTheAdoptRemedy(): void {
  const messages: string[] = [];
  refuseMetadataOverridesThatDoNotSurvive({
    assets: [
      {
        assetId: "a",
        assetCode: "PUMP-01",
        rows: new Map([
          [
            "KW",
            {
              sourceKind: "measured",
              scaleMultiplier: null,
              scaleOffset: null,
              engMin: 150,
              engMax: null,
              qualityPolicy: null,
            },
          ],
        ]),
      },
    ],
    targetPoints: [stored("KW", { engMax: 100 })],
    targetVersion: 2,
    refuse: (refusal) => messages.push(refusal.message),
    operation: "adopt",
  });
  expect([messages.length, messages.some((m) => MIGRATE_WORDS.test(m)), messages[0]?.endsWith("then adopt version 2.")]).toEqual([
    1,
    false,
    true,
  ]);
}

/** Mutation: the insert net's `operation` ignored → "This migration is refused". */
export function theInsertNetNamesTheAdoption(): void {
  const err = Object.assign(new Error("dup"), { code: "23505", constraint: "asset_points_asset_source_key_idx" });
  expect(translateAssetPointInsertUnique(err, "adoption").message).toMatch(/^This adoption is refused\./);
}

/** Mutation: adopt reuses instantiate's rule backstop → "no asset, no point and no rule". */
export function theRuleBackstopSaysNothingWasWritten(): void {
  const err = Object.assign(new Error("dup"), { code: "23505", constraint: "automation_rules_org_code_idx" });
  const message = (translateRuleCodeCollision(err) as Error).message;
  expect([message.includes("adoption"), message.includes("no asset")]).toEqual([true, false]);
}

/** Mutation: the content guard's `operation` ignored → "Cannot instantiate". */
export function theContentGuardSaysAdopt(): void {
  const template = { code: "PUMP", version: 3, content: { optimisation: { any: 1 } } } as unknown as TemplateRow;
  let message = "";
  try {
    parseTemplateContentForInstantiate(template, "adopt");
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toMatch(/^Cannot adopt assets onto PUMP v3:/);
}
