import { waterBalanceRow, type WaterBalanceInputs } from "./water-balance";

/**
 * `E4.3` U9 — the pure half of `water.balance` (ADR 0073 decision 3; plan rulings Q7, Q8, Q9).
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
const FULL: WaterBalanceInputs = { intake: rows(50), reuse: rows(11), discharge: rows(7) };

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

/** Consumed = intake − discharge = 43. Reuse is NOT added (ADR 0073 decision 3, Q7): not 54. */
export function consumedIsIntakeMinusDischargeWithoutReuse(): void {
  same(waterBalanceRow(FULL).consumed, 43, "consumed of 50 − 7 (reuse 11 not added)");
}

/** Coverage over intake + reuse + discharge: `"3/3"`. */
export function coverageCountsTheThreeColumns(): void {
  same(waterBalanceRow(FULL).coverage, "3/3", "coverage of [50], [11], [7]");
}

/** No discharge asset carries (Q8): consumed is `intake − 0` = 50, never `null`. */
export function noDischargeAssetReadsConsumedAsIntake(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: [] }).consumed,
    50,
    "consumed with discharge []",
  );
}

/** No discharge asset carries: coverage counts the two carrying assets, `"2/2"`. */
export function noDischargeAssetCoverageIsTwoOfTwo(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: [] }).coverage,
    "2/2",
    "coverage with discharge []",
  );
}

/** A discharge asset carries and every one is stale (Q8): consumed is `null`, never `intake − 0`. */
export function staleDischargeReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: rows(null) }).consumed,
    null,
    "consumed with discharge [null]",
  );
}

/** The stale discharge asset is carrying and not fresh: `"2/3"`. */
export function staleDischargeCoverageIsTwoOfThree(): void {
  same(
    waterBalanceRow({ intake: rows(50), reuse: rows(11), discharge: rows(null) }).coverage,
    "2/3",
    "coverage with discharge [null]",
  );
}

/** No intake asset carries: intake is `null` — never `0`. */
export function noIntakeAssetReadsIntakeAsNull(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(11), discharge: rows(7) }).intake,
    null,
    "intake with intake []",
  );
}

/** No intake: consumed is `null` whatever discharge reads (Q8) — never `0 − 7`. */
export function noIntakeAssetReadsConsumedAsNull(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(11), discharge: rows(7) }).consumed,
    null,
    "consumed with intake []",
  );
}

/** Reuse `[null, 4]`: the stale row is excluded from the sum, which is 4. */
export function reuseSkipsTheStaleRow(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(null, 4), discharge: [] }).reuse,
    4,
    "reuse of [null, 4]",
  );
}

/** Reuse `[null, 4]` alone: coverage is one fresh of two carrying, `"1/2"`. */
export function reuseStaleRowCountsInCarrying(): void {
  same(
    waterBalanceRow({ intake: [], reuse: rows(null, 4), discharge: [] }).coverage,
    "1/2",
    "coverage of reuse [null, 4]",
  );
}

/** Every input empty: all four numbers `null` and coverage `"0/0"`. */
export function nothingCarryingIsAllNullAtZeroOverZero(): void {
  same(
    waterBalanceRow({ intake: [], reuse: [], discharge: [] }),
    { intake: null, reuse: null, discharge: null, consumed: null, coverage: "0/0" },
    "every input empty",
  );
}
