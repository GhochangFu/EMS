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
 *   0073 decision 3): recovered water already left the intake meter once, and adding it back
 *   would count it twice. The edges (ruling Q8, and the PR 2 review ruling on partial
 *   staleness, and the PR 2 post-merge sweep ruling that gives intake the same guard):
 *   - `null` when intake is `null` — there is nothing to subtract from;
 *   - `null` when the site has an intake-roled asset that does not carry the period's `kl_*`
 *     point (the rows fall short of `intakeAssets`), or when ANY carrying intake asset is
 *     stale — the fresh intakes alone would understate the intake and so the loss. The intake
 *     COLUMN is unchanged by this: it stays the sum of the fresh rows, as reuse and discharge
 *     do;
 *   - `intake − 0` ONLY when the site has NO discharge-roled asset in scope at all — a site
 *     with no discharge meter loses nothing through one;
 *   - `null` when the site has a discharge-roled asset that does not carry the period's
 *     `outlet_kl_*` point (a template pinned before v5: `readRollupRows` returns no row for
 *     it, so the rows fall short of `dischargeAssets`) — a meter that cannot report is not a
 *     zero discharge;
 *   - `null` when ANY carrying discharge asset is stale — a silent meter never yields a
 *     confident number, and a sum over the fresh ones alone would overstate the loss;
 *   - otherwise `intake − discharge`.
 * - **coverage** is `"fresh/carrying"` over the intake, reuse and discharge rows together
 *   (ruling Q9). An `internal` asset feeds no column, so it is no input here and no count.
 *
 * **Coverage decision (PR 2 review):** a role-holding asset that does not carry the period's
 * key is NOT in the denominator. `carrying` keeps the one meaning it has everywhere else —
 * the `sustainability.by_location` table on the same dashboard uses the same string — and a
 * period no template carries still reads `"0/0"` (a pre-v5 tenant's reuse and discharge read
 * `null` and add nothing, as the resolver's re-import note says, while its intake counts). The
 * signal behind a `null` consumed at full coverage is the `null` discharge column beside it:
 * the site has a discharge meter and no reading from it. An intake meter that cannot report
 * has no such signal: the intake column still shows the other intakes' sum, and only the
 * `null` consumed beside a number says that one intake is missing.
 */

/** One site's rows, split by role — what the resolver hands the fold. */
export type WaterBalanceInputs = {
  readonly intake: readonly RollupInput[];
  readonly reuse: readonly RollupInput[];
  readonly discharge: readonly RollupInput[];
  /**
   * Every active discharge-roled asset of the site in scope, carrying or not
   * (`readBalanceLocations`). Compared with `discharge.length` to find the ones that cannot
   * report.
   */
  readonly dischargeAssets: number;
  /**
   * Every active intake-roled asset of the site in scope, carrying or not
   * (`readBalanceLocations`). Compared with `intake.length` for the same reason.
   */
  readonly intakeAssets: number;
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
  // The intake guards run BEFORE the no-discharge branch: a site with no discharge meter still
  // needs every intake meter to report.
  else if (inputs.intake.length !== inputs.intakeAssets) consumed = null;
  else if (intake.coverage.fresh !== intake.coverage.carrying) consumed = null;
  else if (inputs.dischargeAssets === 0 && inputs.discharge.length === 0) consumed = intake.value;
  // `!==`, not `<`: a count that disagrees in either direction is not a number to subtract.
  else if (inputs.discharge.length !== inputs.dischargeAssets) consumed = null;
  else if (discharge.value === null || discharge.coverage.fresh !== discharge.coverage.carrying)
    consumed = null;
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
