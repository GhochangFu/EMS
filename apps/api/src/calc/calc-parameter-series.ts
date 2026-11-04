/**
 * `F4.311` task 5.4 (ADR 0109 decision 7, owner ruling 2) — one candidate row
 * of a `$key`'s value over a time range, as
 * `CalcParametersService.resolveSeriesForAssets` returns it.
 *
 * `rank` is the precedence `resolveForAssets` orders by, as one number: `0`
 * for an asset-scope row, `1 + steps` for a location-scope row (its own node
 * is step 0), and {@link ORGANIZATION_RANK} for the organization-scope row. A
 * lower rank wins. `toMs` is `null` for an open-ended row; validity is
 * half-open, `[fromMs, toMs)`, exactly as the point read's.
 */
export type ParameterSeriesRow = {
  readonly fromMs: number;
  readonly toMs: number | null;
  readonly value: number;
  readonly rank: number;
};

/** The organization-scope row's rank: below every asset and location row. */
export const ORGANIZATION_RANK = 1_000_000;

/**
 * The value in force at `tMs` — the row whose `[fromMs, toMs)` holds `tMs`
 * with the lowest `rank`; `undefined` when no row holds it. `series` must be
 * sorted by `rank` ascending (the read returns it so), so the first row that
 * holds `tMs` is the one the point read would have served. No default: an
 * instant no row covers is absent, as in `resolveForAssets`.
 */
export function parameterValueAt(series: readonly ParameterSeriesRow[], tMs: number): number | undefined {
  for (const row of series) {
    if (row.fromMs <= tMs && (row.toMs === null || tMs < row.toMs)) {
      return row.value;
    }
  }
  return undefined;
}
