import { expect } from "vitest";

import {
  CALC_POINT_BATCH_MAX_ASSETS,
  calcPointBatchBodySchema,
  calcPointSetBodySchema,
} from "./calc-point-writes";

/**
 * `F4.311` PR 2 (ADR 0109 decisions 1, 4, 7) — the standalone calc-point
 * bodies. One claim per function; the `.test.ts` sibling runs them.
 */

const SET_BODY = {
  formula: "{KW} * 2",
  formulaDialect: "bms-calc-v1",
  calcTrigger: "scheduled",
  calcIntervalSeconds: 300,
  maxInputAgeSeconds: 600,
} as const;

const assetIds = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

const batch = (n: number) => ({ assetIds: assetIds(n), pointKey: "KW_X2", ...SET_BODY });

/** A complete standalone body parses. */
export function aCompleteSetBodyParses(): void {
  expect(calcPointSetBodySchema.safeParse(SET_BODY).success).toBe(true);
}

/** Decision 1: there is no template to inherit from, so a null formula is refused. */
export function aNullFormulaIsRefused(): void {
  expect(calcPointSetBodySchema.safeParse({ ...SET_BODY, formula: null }).success).toBe(false);
}

/** `calcIntervalSeconds` is the one nullable field — null is a streaming point's legal value. */
export function aNullIntervalParses(): void {
  expect(
    calcPointSetBodySchema.safeParse({ ...SET_BODY, calcTrigger: "streaming", calcIntervalSeconds: null }).success,
  ).toBe(true);
}

/** `MIN_CALC_INTERVAL_SECONDS` (10) is imported, not restated: 9 is refused. */
export function anIntervalBelowTheMinimumIsRefused(): void {
  expect(calcPointSetBodySchema.safeParse({ ...SET_BODY, calcIntervalSeconds: 9 }).success).toBe(false);
}

/** 31 days is the longest backfill (decision 7). */
export function thirtyOneBackfillDaysParse(): void {
  expect(calcPointSetBodySchema.safeParse({ ...SET_BODY, backfillDays: 31 }).success).toBe(true);
}

/** 32 days is refused. */
export function thirtyTwoBackfillDaysAreRefused(): void {
  expect(calcPointSetBodySchema.safeParse({ ...SET_BODY, backfillDays: 32 }).success).toBe(false);
}

/** `.strict()`: an unknown key is an author's typo and is refused. */
export function anUnknownKeyIsRefused(): void {
  expect(calcPointSetBodySchema.safeParse({ ...SET_BODY, formulaDialekt: "bms-calc-v1" }).success).toBe(false);
}

/** The cap is the ADR's 25. */
export function theBatchCapIsTwentyFive(): void {
  expect(CALC_POINT_BATCH_MAX_ASSETS).toBe(25);
}

/** A batch of 25 assets parses. */
export function aBatchOfTwentyFiveParses(): void {
  expect(calcPointBatchBodySchema.safeParse(batch(25)).success).toBe(true);
}

/** A batch of 26 assets is refused at the schema. */
export function aBatchOfTwentySixIsRefused(): void {
  expect(calcPointBatchBodySchema.safeParse(batch(26)).success).toBe(false);
}

/** An empty batch is refused. */
export function anEmptyBatchIsRefused(): void {
  expect(calcPointBatchBodySchema.safeParse(batch(0)).success).toBe(false);
}

/** The batch carries the set body's rules: a null formula is refused there too. */
export function aBatchWithANullFormulaIsRefused(): void {
  expect(calcPointBatchBodySchema.safeParse({ ...batch(1), formula: null }).success).toBe(false);
}

/** The batch is strict as well. */
export function aBatchWithAnUnknownKeyIsRefused(): void {
  expect(calcPointBatchBodySchema.safeParse({ ...batch(1), organizationId: assetIds(1)[0] }).success).toBe(false);
}
