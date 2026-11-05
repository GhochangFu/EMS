import { expect } from "vitest";

import { refuseOverridesThatDoNotSurvive, type RefusedAsset } from "./asset-templates-migrate-calc";
import type { StoredTemplatePoint } from "./template-version-delta";

/**
 * `F4.312` (plan task 1.4) — the calc override gate hands the refused asset to
 * `refuse` beside the refusal, so adoption's refusals carry `assetId` and
 * `assetCode` as fields. The gate's own rules are proved by the migrate
 * integration suites; this pins only the second argument. The `.test.ts`
 * sibling runs it (ADR 0014).
 */

const DERIVED: StoredTemplatePoint = {
  pointKey: "KW_X2",
  kind: "derived",
  sourceDataKeyPattern: null,
  required: true,
  unit: null,
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
  minCoverageRatio: null,
  scaleMultiplier: null,
  scaleOffset: null,
  engMin: null,
  engMax: null,
  qualityPolicy: null,
};

const overrideRow = (formula: string) => ({
  sourceKind: "computed",
  formula,
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
});

/**
 * Two assets, the second's override naming a key the version does not declare.
 * Mutation: the second argument dropped from the `refuse` call, or another
 * asset's passed.
 */
export async function theRefusedAssetRidesBesideTheRefusal(): Promise<void> {
  const seen: RefusedAsset[] = [];
  await refuseOverridesThatDoNotSurvive({
    assets: [
      { assetId: "id-good", assetCode: "PUMP-GOOD", rows: new Map([["KW_X2", overrideRow("{KW} * 3")]]) },
      { assetId: "id-bad", assetCode: "PUMP-BAD", rows: new Map([["KW_X2", overrideRow("{NOPE} * 3")]]) },
    ],
    targetPoints: [
      { ...DERIVED, pointKey: "KW", kind: "measured", formula: null, formulaDialect: null, calcTrigger: null },
      DERIVED,
    ],
    targetPointIdsByKey: new Map(),
    targetVersion: 2,
    dependencies: { checkCandidates: async () => [] },
    refuse: (_refusal, asset) => seen.push(asset),
  });
  expect(seen).toEqual([{ assetId: "id-bad", assetCode: "PUMP-BAD" }]);
}
