import type { KpiTileStatus } from "../components/kpi-tile";

/**
 * `E4.1c` (ADR 0070 decision 7) — money on the screen.
 *
 * The API's `indicativeCost` and `tariffPerKwh` are nullable, and the currency
 * is `bms.organizations.currency` (ISO 4217) rather than a code spelled in a
 * field name or a `unit` prop. This is the one place an amount and a code
 * become text: `Intl.NumberFormat` in currency style — no library, per the
 * ADR — and `null` when either half is missing, which `costTileProps` turns
 * into the `empty` tile and its dash. The two callers that used to call
 * `.toFixed(2)` and `.toLocaleString` on the raw number are why the null arm
 * is here and not in each of them.
 */

/** Where the number comes from, for an organization that has entered a tariff. */
const COST_HINT = "kWh × the organization's energy tariff (Calc Parameters)";

/**
 * What to do about it, for one that has not — or for a scope that spans two
 * currencies, which the API also answers with `null` (`energy-cost.ts`).
 */
const NO_TARIFF_HINT = "No tariff — enter energy_tariff_per_kwh under Calc Parameters, or narrow the scope to one currency";

type CostTileProps = {
  status: KpiTileStatus;
  value: string | null;
  hint: string;
};

/**
 * The `status`, `value` and `hint` for an indicative-cost tile, given the
 * query's status and the API's nullable cost and currency — the `pueTileProps`
 * decision applied to money. `KpiTile` draws the em dash for `status ===
 * "empty"` and paints a blank tile for `ready` with a `null` value, so a
 * settled query that returned `null` becomes `empty` and the hint says why.
 * `loading` and `error` pass through unchanged.
 */
export function costTileProps(
  status: KpiTileStatus,
  amount: number | null | undefined,
  currency: string | null | undefined,
): CostTileProps {
  if (status !== "ready") {
    return { status, value: null, hint: COST_HINT };
  }
  const value = formatMoney(amount ?? null, currency ?? null);
  if (value === null) {
    return { status: "empty", value: null, hint: NO_TARIFF_HINT };
  }
  return { status, value, hint: COST_HINT };
}

/**
 * Format `amount` in `currency`, or `null` when either is `null`. A code the
 * runtime's ICU does not know (`RangeError`) falls back to `"<amount> <code>"`
 * so a mistyped organization currency shows something readable rather than
 * breaking the page.
 */
export function formatMoney(
  amount: number | null,
  currency: string | null,
  maximumFractionDigits = 0,
): string | null {
  if (amount === null || currency === null) {
    return null;
  }
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits }).format(amount);
  } catch (error) {
    if (error instanceof RangeError) {
      return `${amount.toLocaleString(undefined, { maximumFractionDigits })} ${currency}`;
    }
    throw error;
  }
}
