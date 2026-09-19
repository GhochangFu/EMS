import { costTileProps, formatMoney } from "./money";

/**
 * `E4.1c` (ADR 0070 decision 7) — the one place the web turns an amount and an
 * ISO 4217 code into text. The API's cost fields are nullable and the currency
 * is the organization's, so the helper's job is two-sided: format when both
 * halves are present, and answer `null` — the tile's dash — when either is
 * missing, so no caller ever calls `.toFixed` on a `null` again (the two
 * crash sites this row removed from `energy-page.tsx`).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** The formatted string is exactly what `Intl.NumberFormat` gives — computed here, not pinned, so it is locale-neutral. */
export function assertFormatsWithIntl(): void {
  const expected = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 0,
  }).format(5042.12);
  const actual = formatMoney(5042.12, "ZAR");
  assert(actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  // The positive control on the control: the string carries the amount's digits.
  assert(expected.includes("5"), "the Intl string carries the amount");
}

/** `maximumFractionDigits` is honoured — the ribbon shows the tariff to two decimals. */
export function assertFractionDigitsAreHonoured(): void {
  const expected = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "ZAR",
    maximumFractionDigits: 2,
  }).format(2.15);
  const actual = formatMoney(2.15, "ZAR", 2);
  assert(actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** A null amount is the dash, whatever the currency. */
export function assertNullAmountIsNull(): void {
  assert(formatMoney(null, "ZAR") === null, "a null amount must format to null");
}

/** A null currency is the dash, whatever the amount — an amount with no unit is not money. */
export function assertNullCurrencyIsNull(): void {
  assert(formatMoney(5, null) === null, "a null currency must format to null");
}

/**
 * A code `Intl` refuses falls back to `<amount> <code>` rather than throwing
 * on the page. Measured (Node 24, the browser's ICU class): a well-formed but
 * unassigned code such as `ZZZ` does NOT throw — `Intl.NumberFormat` prints
 * `ZZZ 1,235` — so it never reaches the `catch`; only a malformed code
 * (length ≠ 3) raises `RangeError`. The case therefore drives the fallback
 * with `"ZZ"`, and the positive control beside it pins that `ZZZ` is
 * formatted by `Intl` itself, so a reader does not "fix" the code back.
 */
export function assertUnknownCodeFallsBack(): void {
  const malformed = formatMoney(1234.5, "ZZ");
  assert(malformed === `${(1234.5).toLocaleString(undefined, { maximumFractionDigits: 0 })} ZZ`, `expected the fallback string, got ${JSON.stringify(malformed)}`);
  const unassigned = formatMoney(1234.5, "ZZZ");
  const viaIntl = new Intl.NumberFormat(undefined, { style: "currency", currency: "ZZZ", maximumFractionDigits: 0 }).format(1234.5);
  assert(unassigned === viaIntl, `an unassigned three-letter code is Intl's own output, got ${JSON.stringify(unassigned)}`);
}

/** A settled query with a null cost becomes the `empty` tile — the dash — with the reason, never a blank `ready`. */
export function assertNullCostIsTheEmptyTile(): void {
  const props = costTileProps("ready", null, null);
  assert(props.status === "empty", `expected empty, got ${props.status}`);
  assert(props.value === null, "an empty tile carries no value");
  assert(props.hint.includes("No tariff"), `the hint names the cause, got ${JSON.stringify(props.hint)}`);
}

/** A settled query with a cost is `ready` with the Intl string. */
export function assertACostIsTheReadyTile(): void {
  const props = costTileProps("ready", 5042.12, "ZAR");
  assert(props.status === "ready", `expected ready, got ${props.status}`);
  assert(props.value === formatMoney(5042.12, "ZAR"), "the value is the formatted amount");
}

/** `loading` and `error` pass through untouched — neither has established that nothing is configured. */
export function assertUnsettledStatusPassesThrough(): void {
  assert(costTileProps("loading", null, null).status === "loading", "loading passes through");
  assert(costTileProps("error", null, null).status === "error", "error passes through");
}
