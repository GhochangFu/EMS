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
 * All six are **formula-initiating** characters in Excel and LibreOffice — that is
 * OWASP's set, and TAB and CR are in it on the same footing as the obvious four.
 * An earlier version of this comment said the two were "stripped as leading
 * whitespace on import", which is the wrong mechanism and a dangerous one to leave
 * lying around: it makes deleting `\r` from this list look safe, on the reasoning
 * that the quote trigger below already handles CR. **It is not safe.** `\r` has to
 * be in *both* — the trigger stops the record splitting, this list stops the
 * formula. Removing it from here would reopen the hole while every test still
 * passed, because the specs iterate their own copy of this list and would be
 * edited alongside it.
 *
 * Leading U+0020, U+00A0 and U+FEFF are deliberately **not** here. OWASP's set
 * stops at these six, and a leading space is itself one of the commonly cited
 * text-forcing prefixes. Neither review could verify the behaviour of the three
 * closed-source import parsers, and neither would name a bypass it had not
 * reproduced — see ADR 0026 "Open question". Do not add characters here on
 * reasoning alone; open one file in Excel, LibreOffice and Sheets first.
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
 *
 * **The order is load-bearing.** The apostrophe goes on *before* the trigger is
 * tested, so the guarded form is re-examined and quoted. Swap the two and a
 * CR-led value escapes quoting again. With `,`, `"`, LF and CR all in the trigger,
 * a value cannot break out of its field or forge a record — only its own cell
 * content is under an attacker's control.
 *
 * Takes `string`, not `string | null`. Every caller's columns are `NOT NULL` in
 * the schema, so unlike `audit.serialise.ts`' `cellValue` there is no `?? ""` to
 * do here — but this dereferences `value`, where the old reports code coerced
 * through a regex. A future `DROP NOT NULL` on `bms.assets.code`/`name`/
 * `site_name` would turn the CSV route into a guaranteed 500 while
 * `/reports/energy/preview` stayed 200 on the same row.
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
 * The guard is also total against a bad cast, which is worth knowing since the
 * brand can be forged: `Number.isFinite` does **not** coerce, so a `string`,
 * `undefined` or boxed `Number` smuggled past the erased type all throw here
 * rather than reaching `String()`.
 *
 * @throws if the value is not finite. **This is a real guard, not a dead
 * assertion, and an earlier version of this comment got that wrong** — it claimed
 * finiteness came "by construction" from the report's SQL `COALESCE`s. `COALESCE`
 * handles `NULL`. `NaN` is a legal `double precision` value in Postgres, is
 * neither `NULL` nor caught by `COALESCE`, propagates through `SUM`/`AVG`, and
 * sorts above every value so `MAX` returns it too.
 *
 * **`F4.32` closed the hole this paragraph used to describe.** It read: the
 * guarantee lives in another application — the ingest rejects non-finite samples
 * (`apps/ingest/src/host/normaliser.ts:129`, `adapters/mqtt.ts:222`) — while
 * `apps/api` enforces nothing and the column has no CHECK, so any direct writer
 * can store `'NaN'::float8`.
 *
 * It does now: `point_values_value_finite_check` (migration `0031`) rejects
 * `NaN` and both infinities at the database. Note the constraint is a **range
 * test**, not the `CHECK (value = value)` that `F4.32` prescribed — Postgres
 * defines `NaN = NaN` as true so float columns can be indexed, which makes the
 * classic idiom a no-op here.
 *
 * **The throw below stays**, and not as dead weight. It still guards a bad cast
 * past the erased brand, and it covers every row written before `0031` on a
 * database that has not run it yet. Measured 0 non-finite rows on 2026-08-10 and
 * again on 2026-08-18.
 *
 * Throwing is still right: a `NaN` in a client energy report must not be delivered
 * quietly as the text `"NaN"`, which is what the old code did. But know the failure
 * mode before widening this — it is a **persistent 500** for every range covering
 * that bucket, it is asymmetric (`/reports/energy/preview` returns
 * `"totalKwh": null` for the same data, because `JSON.stringify(NaN)` is `null`),
 * and once the bucket is absorbed into a continuous aggregate, deleting the raw row
 * does not repair it (AGENTS.md §4.4).
 */
export function csvNumberCell(value: number): CsvField {
  if (!Number.isFinite(value)) {
    throw new Error(
      `csvNumberCell received ${String(value)}, which is not a finite number. Nothing in apps/api ` +
        "keeps NaN out of telemetry.point_values — the ingest normaliser does, and it is a " +
        "different application, and on a database predating migration 0031 there is no CHECK behind it — " +
        "of the serialiser. Fix the source rather than emitting the cell, and do not soften this " +
        "to an empty cell: a client-facing energy report must not carry a silent NaN.",
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
