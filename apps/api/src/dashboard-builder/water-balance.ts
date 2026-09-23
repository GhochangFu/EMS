import { rollup, type RollupInput } from "./sustainability-rollup";

/**
 * `E4.3` U9 — the pure half of `water.balance` (ADR 0073 decision 3). The `energy-cost.ts`
 * shape: this file folds rows the database half has already read, and holds every rule of the
 * row so the unit test pins each one without a database.
 *
 * One row per site, over the assets carrying a water balance role:
 *
 * - **intake / reuse / discharge** are each `rollup(rows, "sum").value` over that role's
 *   carrying assets — `null` when none of them has a fresh sample, never `0`.
 * - **consumed** ("consumed or lost") is `intake − discharge`. **Reuse is not added** (ADR
 *   0073 decision 3, plan ruling Q7): recovered water already left the intake meter once, and
 *   adding it back would count it twice. The edges (ruling Q8):
 *   - `null` when intake is `null` — there is nothing to subtract from;
 *   - `intake − 0` when NO discharge asset carries the point — a site with no discharge meter
 *     loses nothing through one;
 *   - `null` when a discharge asset carries and EVERY one is stale — a silent discharge meter
 *     is not a zero discharge, and `intake − 0` would overstate the loss;
 *   - otherwise `intake − discharge`.
 * - **coverage** is `"fresh/carrying"` over the intake, reuse and discharge rows together
 *   (ruling Q9). An `internal` asset feeds no column, so it is no input here and no count.
 */

/** One site's rows, split by role — what the resolver hands the fold. */
export type WaterBalanceInputs = {
  readonly intake: readonly RollupInput[];
  readonly reuse: readonly RollupInput[];
  readonly discharge: readonly RollupInput[];
};

/** One site's balance, in the dataset's cell types. */
export type WaterBalanceRow = {
  readonly intake: number | null;
  readonly reuse: number | null;
  readonly discharge: number | null;
  readonly consumed: number | null;
  readonly coverage: string;
};

/** The fold: three sums, `consumed` by the rule above, and one coverage over the three. */
export function waterBalanceRow(inputs: WaterBalanceInputs): WaterBalanceRow {
  const intake = rollup(inputs.intake, "sum");
  const reuse = rollup(inputs.reuse, "sum");
  const discharge = rollup(inputs.discharge, "sum");

  let consumed: number | null;
  if (intake.value === null) consumed = null;
  else if (discharge.coverage.carrying === 0) consumed = intake.value;
  else if (discharge.value === null) consumed = null;
  else consumed = intake.value - discharge.value;

  const fresh = intake.coverage.fresh + reuse.coverage.fresh + discharge.coverage.fresh;
  const carrying =
    intake.coverage.carrying + reuse.coverage.carrying + discharge.coverage.carrying;
  return {
    intake: intake.value,
    reuse: reuse.value,
    discharge: discharge.value,
    consumed,
    coverage: `${fresh}/${carrying}`,
  };
}
