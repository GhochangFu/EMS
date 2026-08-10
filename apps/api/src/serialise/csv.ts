/**
 * CSV cell escaping, shared by every export in this app (ADR 0026).
 *
 * This repository serves two CSV downloads — the audit log (ADR 0021) and the
 * Energy Consumption report — and until `F4.29` only the first neutralised
 * spreadsheet formulas. The rule now lives in one place so a third export cannot
 * quietly ship without it; `tests/repo-invariants.test.ts` holds that.
 *
 * Two constructors rather than one, because **numeric cells must not be
 * guarded** and the compiler is what enforces it — see `csvNumberCell`.
 */

declare const csvFieldBrand: unique symbol;

/**
 * A cell that has been through one of the constructors below.
 *
 * Branded rather than a plain `string` so that a raw, unescaped value in a row
 * is a **compile error** instead of a silently unguarded cell. ADR 0025 decision
 * 5b records three tests in this repo that were invariant under the change they
 * guarded; a type error is the one check that cannot be.
 */
export type CsvField = string & { readonly [csvFieldBrand]: "escaped" };

/**
 * Characters that make Excel/Sheets treat a CSV cell as a formula.
 *
 * TAB and CR are in OWASP's set alongside the obvious four: both are stripped
 * as leading whitespace on import, exposing whatever follows them.
 *
 * Module-private on purpose. The specs assert against a **literal** copy of this
 * list, because a test that imports the constant cannot detect the constant
 * shrinking.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Escapes a cell that carries text — quoting it, and neutralising a leading
 * formula character by prefixing an apostrophe, which makes the cell literal.
 *
 * CR belongs in the quote trigger and not only in the leader list: a value
 * *starting* with CR is guarded to `'\rfoo`, which still contains a CR and would
 * split the record if it were emitted bare. `reports.service.ts` had exactly that
 * gap before ADR 0026 (fact 4) — its trigger was `/["\n,]/`.
 */
export function csvTextCell(value: string): CsvField {
  const guarded = FORMULA_LEADERS.some((lead) => value.startsWith(lead)) ? `'${value}` : value;
  if (/["\n\r,]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"` as CsvField;
  }
  return guarded as CsvField;
}

/**
 * Renders a numeric cell. **Deliberately unguarded** — see ADR 0026 decision 2.
 *
 * The guard exists to neutralise cells whose Excel *formula* interpretation
 * differs from their literal text. For a numeric literal it does not: `=-5`
 * evaluates to `-5`. So a leading `-` on a number is harmless, while guarding it
 * would make Excel import the cell as **text** and break the client's own
 * arithmetic on the sheet.
 *
 * That argument is structural, not a measurement — `kw` happens to have no
 * negative rows today but `kvar` has 750, so a sign-based justification would not
 * survive (ADR 0026 fact 8).
 *
 * This is a separate function, taking `number`, so that **the compiler** decides
 * which cells are exempt. Re-parsing an already-produced string with a regex and
 * skipping the guard when it looks numeric was considered and rejected: that
 * branch is the one that becomes the vulnerability.
 *
 * @throws if the value is not finite. Every caller's value is finite by
 * construction — the report's SQL `COALESCE`s each aggregate and
 * `energyTariffZar()` gates on `Number.isFinite` — so this is an assertion rather
 * than a reachable path. A `NaN` in a client energy report is a data-integrity
 * failure that must not be delivered quietly as the text `"NaN"`.
 */
export function csvNumberCell(value: number): CsvField {
  if (!Number.isFinite(value)) {
    throw new Error(
      `csvNumberCell received ${String(value)}, which is not a finite number. Every value ` +
        "reaching a CSV export is finite by construction, so this is a defect upstream of the " +
        "serialiser — fix the source rather than emitting the cell. Do not soften this to an " +
        "empty cell: a client-facing energy report must not carry a silent NaN.",
    );
  }
  // `String` of a finite number can only lead with `-`, which decision 2 exempts.
  return String(value) as CsvField;
}

/**
 * Joins escaped rows into a CSV document: comma-separated, LF line endings,
 * always terminated by a newline. An empty row emits a blank line.
 */
export function csvDocument(rows: readonly (readonly CsvField[])[]): string {
  return `${rows.map((row) => row.join(",")).join("\n")}\n`;
}
