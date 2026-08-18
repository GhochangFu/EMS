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
 * **`F4.50` weakened the second half of that sentence, so read it with the
 * `QUOTE_TRIGGER` block below.** "The trigger stops the record splitting" holds
 * for a **comma-delimited** reader and only for one. A consumer that splits on
 * TAB, `;` or `|` tears through our quotes, so for that consumer the trigger
 * stops nothing and this list is the only thing left. The conclusion above is
 * unchanged and in fact strengthened — `\r` belongs here — but do not carry the
 * "the trigger has it covered" half into any new reasoning.
 *
 * **Leading whitespace is handled separately, and it is not theoretical.**
 * ADR 0026 left it an open question — a value led by U+0020, U+00A0 or U+FEFF
 * passed this list unmatched. `F4.31` ran the experiment, and **Google Sheets
 * evaluated a cell led by a single U+0020 space**: `" =1+1"` imported as `2`.
 * The unguarded control in the same file also evaluated, so that is a real
 * result and not an artifact. Excel 2013 did not evaluate any of the three, and
 * Sheets did not evaluate U+00A0 or U+FEFF — but one parser evaluating is
 * enough, and this list is shared by both CSV exports.
 *
 * The fix is in `csvTextCell` rather than here, and it is deliberately the
 * **class** and not the instance (AGENTS.md §4.4): the guard now also tests the
 * value with leading whitespace stripped, so `"  =1+1"`, `"  =1+1"` and any
 * other run of whitespace before a leader are covered — not only the single
 * space that happened to be tested. Adding `" "` here would have fixed exactly
 * the one case the probe used.
 *
 * Module-private on purpose. The specs assert against a **literal** copy of this
 * list, because a test that imports the constant cannot detect the constant
 * shrinking.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Characters that force a cell to be quoted.
 *
 * `"`, LF, CR and `,` are RFC 4180: they are what can break a cell out of its
 * own field in a **comma**-delimited reader. TAB, `;` and `|` are not — they are
 * here because of `F4.50`, and the reason is measured rather than defensive.
 *
 * **Excel 2013 evaluated a formula out of an unquoted cell in four different
 * consumers**, none of which reads the file as comma-delimited:
 *
 * | Consumer | Cell as imported |
 * |---|---|
 * | Clipboard paste, TAB delimiter | `tab_split,foo` · **`=1+1` → 2** |
 * | Clipboard paste, `;` delimiter | `semicolon_split,foo` · **`=1+1` → 2** |
 * | File open, comma+TAB (the LibreOffice sticky-checkbox shape; measured in Excel, LibreOffice untested) | `tab_split` · `foo` · **`=1+1` → 2** |
 * | File open, `;` only (Excel double-click in a `;`-list-separator locale) | `semicolon_split,foo` · **`=1+1` → 2** |
 *
 * `|` was not in `F4.50`'s description, and it is **not a default checkbox** —
 * both wizards offer Tab / Comma / Semicolon / Space, and `|` is reachable only
 * through the free-text "Other" field. It was added on the argument that it
 * "measures identically", which was **an assumption at the time it was written**
 * and is now a measurement. Opened with `|` as the only delimiter, the unguarded
 * bytes evaluate; opened with comma+`|`, the guarded cell arrives intact while
 * the unguarded one in the same table splits and evaluates. That run is the
 * cleanest single piece of evidence for this whole change, because it puts the
 * before and after side by side under one parser.
 *
 * **Space is deliberately excluded, and the honest reason is cost — not safety.**
 * An earlier version of this paragraph gave the membership rule as "separators
 * that are default-offered *and* absent from our data", which dressed an
 * engineering trade-off up as a principle. Space is a **default checkbox** in
 * both import wizards, and `"Pump A =1+1 x"` split on space yields a clean
 * `=1+1` fragment with not even a trailing quote to spoil it. So a
 * space-delimited import **remains exploitable after this change**. It is
 * excluded because quoting on it would quote nearly every cell either export
 * emits, which is a real cost against a consumer choice nobody has made — not
 * because it is safe. The class "separator some consumer might pick" has no
 * bound, and this list does not claim to enumerate it.
 *
 * **What this buys is narrower than it looks, and the deciding variable is not
 * the one you would guess.** It is **whether the comma is among the consumer's
 * delimiters** — not which extra separator that consumer adds.
 *
 * Excel honours the `"` text qualifier only when the quote **opens a field**.
 *
 * - **Comma among the delimiters** (comma+TAB, comma+`;`): our quote sits on a
 *   real field boundary, so it is honoured and the cell arrives **intact** —
 *   measured with one, two and three separators in the same cell. **Closed.**
 * - **Comma not a delimiter at all** (`;`-only open, and both clipboard pastes):
 *   our quote is text in the middle of a field. Excel splits straight through
 *   it, and quoting buys **much less than it first appears**.
 *
 * The first write-up of this said those cases were "mitigated", because a single
 * separator leaves the closing `"` stuck to the formula fragment and `=1+1"` is
 * invalid. **That generalised from one payload shape and is false.** Put *two*
 * separators in one cell and the closing quote lands on a later fragment:
 * `"foo;=1+1;bar"` imports as `"foo` · **`=1+1` → 2** · `bar"`. Measured, with a
 * working control, on `foo;=1+1;bar`, `foo;=1+1;`, `a;=1+1;b;c` and the TAB
 * equivalent. **So for a non-comma consumer this is not a guard at all** — it
 * narrows the payloads that work, and nothing more. Tracked as `F4.51`.
 *
 * **The apostrophe guard falls to the same split, and that is worth stating
 * separately** because this module presents the two as a pair — apostrophe for
 * the formula, quote for the field. `"\t=1+1\tz"` re-cut on TAB yields a bare
 * `=1+1` fragment; the `'` sits at the head of the *whole cell*, so once a
 * consumer re-cuts the field there is nothing in front of the formula. Against a
 * non-comma consumer with an adaptive payload, **neither half holds**.
 *
 * The honest limit: a consumer that imports an RFC 4180 comma-delimited file
 * without the comma is misreading it, and **no cell-level escaping in this
 * module can repair that**, because both guards are positional and a re-split
 * moves the position. Protecting every fragment means rewriting the operator's
 * own data, which breaks the reader that is doing it right.
 *
 * Byte cost when this shipped: **zero**, measured 2026-08-18. TAB, `;` and `|`
 * appeared in 0 rows of every column either export emits that can hold them:
 * `bms.assets.code`/`.name`/`.site_name` (148), `bms.locations.name` (17),
 * `bms.audit_log.reason`/`.action`/`.entity_type` and the joined `users.email`
 * (5487). The remaining exported columns cannot hold one by construction —
 * `id`/`actor_id`/`entity_id` are `uuid`, `created_at` is a timestamp, and the
 * report's `template.title` is a literal in `reports.service.ts`. `payload` is
 * covered below. Latent, exactly like ADR 0026 fact 3, and invisible to any test
 * that reads only real data.
 *
 * **`payload` was never exposed to this**, contrary to the first draft of this
 * paragraph. `audit.serialise.ts` renders it through `JSON.stringify`, which
 * emits TAB, CR and LF as the two-character escapes `\t`, `\r`, `\n` rather than
 * the characters themselves; and any object, array or string payload contains a
 * `"`, so the cell was already quoted under the old trigger. Only a bare `5` or
 * `true` escapes quoting, and neither carries a separator.
 */
const QUOTE_TRIGGER = /["\n\r,\t;|]/;

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
 * CR-led value escapes quoting again.
 *
 * This paragraph used to end: "a value cannot break out of its field or forge a
 * record — only its own cell content is under an attacker's control." **`F4.50`
 * measured that claim false**, and it is worth knowing *how* it was false rather
 * than only that it was. It held for a comma-delimited reader and silently
 * assumed every reader is one. Excel 2013 evaluated `foo<TAB>=1+1` out of its
 * field in four consumers that are not — see `QUOTE_TRIGGER`. Widening the
 * trigger closes the ones where the comma is still a delimiter and, for the
 * rest, only **narrows the payloads that work** — two separators in a cell and
 * the formula evaluates anyway (`F4.51`). **It does not restore the original
 * claim**, because Excel ignores a `"` that does not open a field. Do not
 * reinstate a sentence of that shape here.
 *
 * Takes `string`, not `string | null`. Every caller's columns are `NOT NULL` in
 * the schema, so unlike `audit.serialise.ts`' `cellValue` there is no `?? ""` to
 * do here — but this dereferences `value`, where the old reports code coerced
 * through a regex. A future `DROP NOT NULL` on `bms.assets.code`/`name`/
 * `site_name` would turn the CSV route into a guaranteed 500 while
 * `/reports/energy/preview` stayed 200 on the same row.
 */
export function csvTextCell(value: string): CsvField {
  // **Both, and both are load-bearing** (`F4.31`).
  //
  // The trimmed check is the fix for the Sheets bypass: it strips a leading run
  // of whitespace — U+0020, U+00A0, U+FEFF and any mixture — and asks whether a
  // formula leader is underneath. `String.prototype.trimStart` covers all three
  // characters ADR 0026 asked about, which was verified rather than assumed.
  //
  // The raw check is kept, and the reason is narrower than an earlier version of
  // this comment claimed — the security review corrected it. TAB and CR are
  // *themselves* leaders **and** whitespace, so they trim to the empty string;
  // the raw check is therefore uniquely load-bearing only for `"\t"`, `"\r"`,
  // `"\tfoo"` and their kin, **none of which carries a formula body**.
  // `"\t=1+1"` is caught by the trimmed check. Dropping the raw test would be a
  // behaviour change and a departure from OWASP's rule as stated, not an
  // exploitable regression. It stays because it is free and correct.
  //
  // **Known gap, and it is the contiguity rather than any one character.**
  // `trimStart` strips a *contiguous* run, so one character it does not know —
  // U+200B, U+200E, a C0 control — anywhere in the leading run disables the whole
  // trimmed check: `"​ =1+1"` is unguarded today. Not closed on reasoning,
  // per this module's own rule: Sheets was measured **not** to evaluate behind
  // U+00A0 or U+FEFF, both of which `trimStart` does strip, so its strip set
  // looks strictly narrower than ours. `csv-formula-probe.ts` carries the rows
  // that would settle it.
  const leads = (candidate: string): boolean =>
    FORMULA_LEADERS.some((lead) => candidate.startsWith(lead));
  const guarded = leads(value) || leads(value.trimStart()) ? `'${value}` : value;
  // Safe as a module constant: no `g` flag, so there is no `lastIndex` to carry
  // between calls.
  if (QUOTE_TRIGGER.test(guarded)) {
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
