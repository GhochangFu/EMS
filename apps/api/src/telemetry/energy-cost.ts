/**
 * `E4.1c` — the indicative energy cost, read from a parameter rather than an
 * environment variable (ADR 0070 decision 7).
 *
 * ## What this replaces
 *
 * `DashboardService` and `ReportsService` each carried a private tariff reader
 * that took one number from the process environment with a hardcoded Rand
 * default, and the DTO fields named that currency. Both readers are deleted in
 * the same pull request as this file, and `tests/adr-0070-calc-v3-invariants`
 * part (f) scans the tree so neither the variable nor the old field names can
 * come back. (The variable and the default are deliberately not spelled here:
 * a comment *about* them must not be what the scan finds.)
 *
 * The tariff is now `energy_tariff_per_kwh`, a `bms.calc_parameters` row the
 * organization enters on `/admin/calc-parameters`, resolved **per asset at the
 * nearest scope** through `CalcParametersService.resolveForAssets` (the
 * owner's Q4 ruling of 2026-09-19): the organization row for everyone, a
 * location row where one exists, an asset row where one exists. The currency
 * is `bms.organizations.currency` (migration `0076`), joined onto the same
 * per-asset statement. Both services reduce their per-asset rows to this
 * function's input and return its output as the contract's three fields.
 *
 * ## The three fail-closed rules
 *
 * - **`currency`** is the one distinct currency of the rows, else `null`. A
 *   global administrator whose scope spans two organizations in two currencies
 *   sees the dash: a sum across currencies is not a number.
 * - **`tariffPerKwh`** is the one distinct resolved tariff when **every** row
 *   resolved, else `null`. Two tariffs in scope (a location override beside
 *   the organization row) still sum — per asset — but there is no single
 *   tariff to show on the ribbon.
 * - **`indicativeCost`** is Σ `kwh_i × tariff_i`, rounded to two decimals, when
 *   every row resolved **and** `currency` is non-null, else `null`. A partial
 *   sum understates, which is worse than no number.
 *
 * `null`, never `0`, is ADR 0070 decision 2's rule at the read, and it is why
 * the contract's three fields went `.nullable()`. **No default value anywhere**:
 * `tests/adr-0070` part (g) scans this file for `COALESCE(`, `?? 0` and `?? 1`.
 */

/** One asset's energy in the window, as both services' per-asset statement returns it. */
export interface PerAssetEnergy {
  readonly assetId: string;
  readonly kwh: number;
  /** `bms.organizations.currency` of the asset's organization (ISO 4217). */
  readonly currency: string;
}

/** The three contract fields, in the shape `energyCentreSummarySchema` declares them. */
export interface EnergyCostResult {
  readonly indicativeCost: number | null;
  readonly tariffPerKwh: number | null;
  readonly currency: string | null;
}

const NOTHING: EnergyCostResult = { indicativeCost: null, tariffPerKwh: null, currency: null };

/**
 * Reduce the per-asset rows and their resolved tariffs to the contract's three
 * fields. `tariffs` is keyed by `assetId`; an entry for an asset that is not in
 * `rows` is ignored (the resolver answers every pair it was asked, and the
 * caller may ask for more than it sums).
 */
export function energyCost(
  rows: readonly PerAssetEnergy[],
  tariffs: ReadonlyMap<string, number>,
): EnergyCostResult {
  if (rows.length === 0) {
    return NOTHING;
  }

  const currencies = new Set(rows.map((row) => row.currency));
  const currency = currencies.size === 1 ? rows[0]!.currency : null;

  let sum = 0;
  const distinctTariffs = new Set<number>();
  for (const row of rows) {
    const tariff = tariffs.get(row.assetId);
    if (tariff === undefined || !Number.isFinite(tariff) || !Number.isFinite(row.kwh)) {
      // One unresolved asset fails the whole read closed: a partial sum is
      // not "the cost of the scope", it is a smaller number with the same label.
      return { indicativeCost: null, tariffPerKwh: null, currency };
    }
    distinctTariffs.add(tariff);
    sum += row.kwh * tariff;
  }

  const tariffPerKwh = distinctTariffs.size === 1 ? [...distinctTariffs][0]! : null;
  const indicativeCost = currency === null ? null : Math.round(sum * 100) / 100;
  return { indicativeCost, tariffPerKwh: currency === null ? null : tariffPerKwh, currency };
}
