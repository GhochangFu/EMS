import { waterBalanceRow, type WaterBalanceInputs } from "./water-balance";

/**
 * `E4.3` U9 — the pure half of `water.balance` (ADR 0073 decision 3; plan rulings Q8, Q9 and the PR 2 review rulings).
 * Assertions live here; `water-balance.test.ts` is the Vitest entry point (ADR 0014). One
 * exported function per claim, so a mutation reddens the claim it targets and no other.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const same = (actual: unknown, expected: unknown, what: string): void => {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

const rows = (...values: (number | null)[]) => values.map((value) => ({ value }));

/** Intake 50, reuse 11, discharge 7, every asset fresh. */
const FULL: WaterBalanceInputs = {
  intake: rows(50),
  reuse: rows(11),
  discharge: rows(7),
  dischargeAssets: 1,
  intakeAssets: 1,
};

/** Intake is the `sum` over the intake rows: 50. */
export function intakeIsTheIntakeSum(): void {
  same(waterBalanceRow(FULL).intake, 50, "intake of [50]");
}

/** Reuse is the `sum` over the reuse rows: 11. */
export function reuseIsTheReuseSum(): void {
  same(waterBalanceRow(FULL).reuse, 11, "reuse of [11]");
}

/** Discharge is the `sum` over the discharge rows: 7. */
export function dischargeIsTheDischargeSum(): void {
  same(waterBalanceRow(FULL).discharge, 7, "discharge of [7]");
}

/** Consumed = intake − discharge = 43. Reuse is NOT added (ADR 0073 decision 3): not 54. */
export function consumedIsIntakeMinusDischargeWithoutReuse(): void {
  same(waterBalanceRow(FULL).consumed, 43, "consumed of 50 − 7 (reuse 11 not added)");
}

/** Coverage over intake + reuse + discharge: `"3/3"`. */
export function coverageCountsTheThreeColumns(): void {
  same(waterBalanceRow(FULL).coverage, "3/3", "coverage of [50], [11], [7]");
}

/** The site has no discharge-roled asset at all (Q8): consumed is `intake − 0` = 50, never `null`. */
export function noDischargeAssetReadsConsumedAsIntake(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: [], dischargeAssets: 0, intakeAssets: 1 }).consumed,
    50,
    "consumed with discharge []",
  );
}

/** No discharge-roled asset: coverage counts the two carrying assets, `"2/2"`. */
export function noDischargeAssetCoverageIsTwoOfTwo(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: [], dischargeAssets: 0, intakeAssets: 1 }).coverage,
    "2/2",
    "coverage with discharge []",
  );
}

/** The one discharge asset carries and is stale (Q8): consumed is `null`, never `intake − 0`. */
export function staleDischargeReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: rows(null), dischargeAssets: 1, intakeAssets: 1 }).consumed,
    null,
    "consumed with discharge [null]",
  );
}

/** The stale discharge asset is carrying and not fresh: `"2/3"`. */
export function staleDischargeCoverageIsTwoOfThree(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: rows(null), dischargeAssets: 1, intakeAssets: 1 }).coverage,
    "2/3",
    "coverage with discharge [null]",
  );
}

/** No intake asset carries: intake is `null` — never `0`. */
export function noIntakeAssetReadsIntakeAsNull(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(11), discharge: rows(7), dischargeAssets: 1, intakeAssets: 0 }).intake,
    null,
    "intake with intake []",
  );
}

/** No intake: consumed is `null` whatever discharge reads (Q8) — never `0 − 7`. */
export function noIntakeAssetReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(11), discharge: rows(7), dischargeAssets: 1, intakeAssets: 0 }).consumed,
    null,
    "consumed with intake []",
  );
}

/** Reuse `[null, 4]`: the stale row is excluded from the sum, which is 4. */
export function reuseSkipsTheStaleRow(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(null, 4), discharge: [], dischargeAssets: 0, intakeAssets: 0 }).reuse,
    4,
    "reuse of [null, 4]",
  );
}

/** Reuse `[null, 4]` alone: coverage is one fresh of two carrying, `"1/2"`. */
export function reuseStaleRowCountsInCarrying(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(null, 4), discharge: [], dischargeAssets: 0, intakeAssets: 0 }).coverage,
    "1/2",
    "coverage of reuse [null, 4]",
  );
}

/**
 * PR 2 review F2 (Q8 partial staleness): discharge `[7, null]` over two discharge assets —
 * one meter is silent, so consumed is `null`, never `50 − 7`.
 */
export function partlyStaleDischargeReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: rows(7, null), dischargeAssets: 2, intakeAssets: 1 })
      .consumed,
    null,
    "consumed with discharge [7, null] over two discharge assets",
  );
}

/**
 * PR 2 review F1: one discharge-roled asset that carries nothing (a pre-v5 template, so
 * `readRollupRows` returns no row for it) — consumed is `null`, never `intake − 0`.
 */
export function nonCarryingDischargeAssetReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: [], dischargeAssets: 1, intakeAssets: 1 }).consumed,
    null,
    "consumed with discharge [] over one discharge-roled asset",
  );
}

/**
 * PR 2 review F1, the case only the count comparison decides: discharge `[7]` fresh, but the
 * site has TWO discharge-roled assets and the other carries nothing — `null`, never 43.
 */
export function oneOfTwoDischargeAssetsCarryingReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: rows(7), dischargeAssets: 2, intakeAssets: 1 })
      .consumed,
    null,
    "consumed with discharge [7] over two discharge-roled assets",
  );
}

/**
 * The coverage decision (PR 2 review): a discharge-roled asset that carries nothing is NOT in
 * the denominator — coverage stays `"fresh/carrying"`, so intake `[50]` alone reads `"1/1"`.
 */
export function nonCarryingDischargeAssetIsNotInCoverage(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: [], dischargeAssets: 1, intakeAssets: 1 }).coverage,
    "1/1",
    "coverage with discharge [] over one discharge-roled asset",
  );
}

/**
 * PR 2 post-merge sweep (the intake ruling): intake `[50]` fresh, but the site has TWO
 * intake-roled assets and the other carries no `kl_*` point for the period — consumed is
 * `null`, never `50 − 7`. Discharge is clean, so only the intake count comparison decides.
 */
export function oneOfTwoIntakeAssetsCarryingReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: rows(7), dischargeAssets: 1, intakeAssets: 2 })
      .consumed,
    null,
    "consumed with intake [50] over two intake-roled assets",
  );
}

/**
 * The intake ruling, freshness: intake `[50, null]` over two carrying intake assets — one meter
 * is silent, so consumed is `null`, never `50 − 7`. The count matches, so only the intake
 * freshness check decides.
 */
export function partlyStaleIntakeReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50, null), reuse: [], discharge: rows(7), dischargeAssets: 1, intakeAssets: 2 })
      .consumed,
    null,
    "consumed with intake [50, null] over two intake assets",
  );
}

/**
 * The intake ruling changes `consumed` only: the intake COLUMN stays the sum of the fresh rows,
 * 50, when a second intake-roled asset carries nothing.
 */
export function nonCarryingIntakeAssetKeepsTheIntakeColumn(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: [], discharge: rows(7), dischargeAssets: 1, intakeAssets: 2 })
      .intake,
    50,
    "intake with intake [50] over two intake-roled assets",
  );
}

/** Every input empty: all four numbers `null` and coverage `"0/0"`. */
export function nothingCarryingIsAllNullAtZeroOverZero(): void {
  same(
    waterBalanceRow({ intake: [], reuse: [], discharge: [], dischargeAssets: 0, intakeAssets: 0 }),
    { intake: null, reuse: null, discharge: null, consumed: null, coverage: "0/0" },
    "every input empty",
  );
}
