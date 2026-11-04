import { assetPointCalcConfigDtoSchema } from "./asset-templates";
import { calcBackfillRunDtoSchema } from "./calc-backfill";
import { assetPointCalcOverrideBodySchema } from "./calc-override-writes";
import { assetPointCalcConfigListResponseSchema } from "./envelopes";

/**
 * `F4.311` PR 1 (ADR 0109 decision 4) — the calc config DTO says which kind
 * of calculated point it served, and the list says which mode the asset is
 * in. Assertions live here; the Vitest entry is the sibling `.test.ts`
 * (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const EMPTY = {
  formula: null,
  formulaDialect: null,
  calcTrigger: null,
  calcIntervalSeconds: null,
  maxInputAgeSeconds: null,
};

const STORED = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 60,
  maxInputAgeSeconds: 300,
};

/** A standalone item, as `CalcPointStandaloneService.list` will emit it. */
export const STANDALONE_ITEM = {
  pointKey: "KW_X2",
  kind: "standalone",
  templatePointId: null,
  label: "kW doubled",
  unit: "kW",
  assetPointId: "8d2b8f43-6a0b-4d0e-9a7f-3f3a1f1f0a01",
  template: EMPTY,
  override: STORED,
  effective: STORED,
  minCoverageRatio: null,
  runtime: null,
  backfill: null,
};

export function assertAnItemWithoutKindFailsToParse(): void {
  const { kind: _kind, ...withoutKind } = STANDALONE_ITEM;
  assert(
    !assetPointCalcConfigDtoSchema.safeParse(withoutKind).success,
    "an item with no `kind` must fail to parse — the page cannot tell an override from a standalone point",
  );
}

export function assertANullTemplatePointIdParses(): void {
  const result = assetPointCalcConfigDtoSchema.safeParse(STANDALONE_ITEM);
  assert(
    result.success,
    `a standalone item with templatePointId: null must parse: ${JSON.stringify(result.error?.issues)}`,
  );
}

export function assertAListWithoutModeFailsToParse(): void {
  assert(
    !assetPointCalcConfigListResponseSchema.safeParse({ items: [] }).success,
    "a list with no `mode` must fail to parse — an empty standalone list has no item to read the kind from",
  );
}

export function assertAnEmptyStandaloneListParses(): void {
  const result = assetPointCalcConfigListResponseSchema.safeParse({ items: [], mode: "standalone" });
  assert(result.success, `an empty standalone list must parse: ${JSON.stringify(result.error?.issues)}`);
}

// --- F4.311 PR 5b: the latest backfill run on each item (ADR 0109 decision 7) ---

const RUN = {
  id: "5d9c4f43-6a0b-4d0e-9a7f-3f3a1f1f0a02",
  status: "running",
  fromAt: "2026-10-04T00:00:00.000Z",
  toAt: "2026-11-04T00:00:00.000Z",
  doneThrough: "2026-10-07T00:00:00.000Z",
  writtenRows: 4320,
  error: null,
  createdAt: "2026-11-04T00:00:00.000Z",
  finishedAt: null,
};

export function assertAnItemWithoutBackfillFailsToParse(): void {
  const { backfill: _backfill, ...withoutBackfill } = STANDALONE_ITEM;
  assert(
    !assetPointCalcConfigDtoSchema.safeParse(withoutBackfill).success,
    "an item with no `backfill` must fail to parse — `null` is how a point with no run says so",
  );
}

export function assertAnItemWithARunParses(): void {
  const result = assetPointCalcConfigDtoSchema.safeParse({ ...STANDALONE_ITEM, backfill: RUN });
  assert(result.success, `an item carrying its latest run must parse: ${JSON.stringify(result.error?.issues)}`);
}

export function assertARunWithAnUnknownStatusFailsToParse(): void {
  assert(
    !calcBackfillRunDtoSchema.safeParse({ ...RUN, status: "paused" }).success,
    "a run status outside queued/running/done/failed must fail to parse — the vocabulary is closed",
  );
}

export function assertTheOverrideBodyAcceptsBackfillDays(): void {
  const body = { ...EMPTY, formula: "{KW} * 3", backfillDays: 31 };
  assert(
    assetPointCalcOverrideBodySchema.safeParse(body).success,
    "the override PUT accepts backfillDays up to 31 (owner ruling 1)",
  );
}

export function assertTheOverrideBodyRefuses32BackfillDays(): void {
  const body = { ...EMPTY, formula: "{KW} * 3", backfillDays: 32 };
  assert(!assetPointCalcOverrideBodySchema.safeParse(body).success, "the override PUT refuses backfillDays 32");
}
