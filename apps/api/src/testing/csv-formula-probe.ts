import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { csvDocument, csvTextCell, type CsvField } from "../serialise/csv";

/**
 * `F4.31` — generates the CSV that answers ADR 0026's open question.
 *
 * ## The question
 *
 * `FORMULA_LEADERS` in `../serialise/csv.ts` is OWASP's six (`=` `+` `-` `@`
 * TAB CR). A value led by **U+0020, U+00A0 or U+FEFF** passes `csvTextCell`
 * unmodified *and* unquoted — no leader match, no quote trigger. Whether Excel,
 * LibreOffice or Sheets strips such a prefix and *then* evaluates what follows
 * is an empirical question about three closed-source parsers, and neither
 * `F4.29` review would name a bypass it could not reproduce.
 *
 * ## Why this is a script and not a test
 *
 * The answer cannot be asserted from Node. It lives in three parsers, none of
 * which is a library. So this generates the artifact and the *human* runs the
 * three imports. Committing it makes the result **reproducible** rather than a
 * claim in a document — which matters, because a negative result recorded
 * without a method is exactly the kind of thing that gets reopened.
 *
 * ## Run it
 *
 *     pnpm csv:formula-probe            # writes into the repo root
 *     pnpm csv:formula-probe <dir>
 *
 * Output goes to **stderr** via `console.error`, matching the only console call
 * `migrate.ts`, `seed.ts` and `refresh-aggregates.ts` make — §4.5 reserves
 * `console.log` for the Pino logger.
 *
 * Two files are written, and **both are needed**:
 *
 * - `csv-formula-probe.csv` — no BOM, exactly what `apps/api` serves today.
 * - `csv-formula-probe-bom.csv` — the same bytes behind a UTF-8 BOM.
 *
 * The second exists because of a trap this probe found the first time it ran.
 * `apps/api` sends `Content-Type: text/csv; charset=utf-8` but writes **no
 * BOM**, and Excel ignores the header when opening a file: it decoded the file
 * as ANSI, so U+00A0 arrived as `Â` + NBSP and U+FEFF as `ï»¿`. Both then begin
 * with a *letter*, which is trivially not a formula — so the run "passed" while
 * testing nothing. **A result from the no-BOM file alone is not an answer to the
 * question.** Use it to see what the shipped export does; use the BOM file to
 * put the actual characters in front of the parser.
 *
 * ## Read the result
 *
 * For each row, does the cell display `2`?
 *
 * **There are three controls, and which one is valid depends on the delimiter.**
 * Reading the wrong one is how a vacuous run gets recorded as a clean negative —
 * it has happened, see the trap list below.
 *
 * - `CONTROL_unguarded` (`CONTROL_unguarded,=1+1`) — valid **only for a
 *   comma-delimited import**, where it puts `=1+1` in its own cell. Under a TAB
 *   or `;` import the line stays one cell beginning `CONTROL`, which is trivially
 *   not a formula, so it **cannot** display `2` and proves nothing.
 * - The **last line of the file** is a bare `=1+1` — a one-cell row, and
 *   therefore delimiter-independent. **Use this one whenever the import is not
 *   comma-delimited.** It must display `2`.
 * - `CONTROL_split_tab` / `_semicolon` / `_pipe` — the shipped bytes as they were
 *   *before* `F4.50`: a raw `foo<sep>=1+1` bypassing the guard, one per
 *   separator. **Read the one matching your delimiter.** These answer a question
 *   the other two cannot: *did this import split the field at all?* Without them
 *   "the guarded rows did not evaluate" is indistinguishable from "this parser
 *   never split anything", and the quoting fix looks confirmed when it was never
 *   exercised.
 *
 * If the control matching your delimiter does not display `2`, that parser does
 * not evaluate CSV formulas in that mode and the run proves nothing.
 *
 * Then read the payload rows:
 *
 * - `plain` must not display `2`. That is the shipped guard working.
 * - `space_u0020`, `nbsp_u00a0`, `bom_ufeff`, `zwsp_lead`, `zwsp_inner` — the
 *   leading-whitespace question. **If any displays `2`, that is a live
 *   vulnerability in shipped code**; widen the guard and add a test. If none
 *   does, record the negative in ADR 0026 with the parser name and version.
 * - `tab_split`, `semicolon_split`, `pipe_split` must not display `2` **while
 *   the matching `CONTROL_split_*` does**. Only that pairing is a result; either
 *   half alone is not.
 */

/**
 * The payloads, each fed through the *real* shipped guard.
 *
 * The first four are ADR 0026's original question. `space_u0020` is the one
 * that **evaluated in Google Sheets**, which is why the guard now trims.
 *
 * The rest were added by the security review of that fix and are **not yet
 * answered by any parser**:
 *
 * - `zwsp_lead` / `zwsp_inner` — `trimStart` strips a *contiguous* run, so one
 *   character it does not know (U+200B here) anywhere in the prefix disables
 *   the whole trimmed check. This is the discriminating test for "does a parser
 *   strip something `trimStart` does not".
 * - `tab_split` / `semicolon_split` / `pipe_split` — a different class: not
 *   formula *detection* but **field splitting**. **Answered by `F4.50`, and the
 *   answer was yes.** Excel 2013 evaluated `=1+1` out of the unquoted cell in
 *   four consumers: a clipboard paste under a TAB delimiter, the same under `;`,
 *   a file open with comma+TAB, and a file open with `;` only. All three
 *   characters are now in the quote trigger, so this probe emits them **quoted**
 *   — the rows stay because re-running them is how the fix is checked, not
 *   because the question is still open.
 *
 * A row here is a question, not a claim. Put the answer in ADR 0026.
 *
 * ## Three traps this probe has fallen into
 *
 * All three are the same shape — a run that looks like a clean negative but
 * asked nothing — and each was one step from being recorded as a result.
 *
 * 1. **Encoding** (`F4.31`). No BOM meant Excel decoded ANSI, so `U+00A0` became
 *    `Â`+NBSP and `U+FEFF` became `ï»¿`. Both begin with a *letter*. Hence the
 *    two output files.
 * 2. **The delimiter arguments** (`F4.50`). `Workbooks.OpenText` **ignores** its
 *    `Tab`/`Semicolon`/`Comma` arguments when the file extension is `.csv` and
 *    uses the locale list separator instead. Four runs returned identical tables
 *    and the comma split even with `Comma:=False`. Copy to `.txt` first. And a
 *    clipboard paste follows Excel's **sticky** import delimiters rather than
 *    TAB unconditionally — set them deliberately, and put them back.
 * 3. **The control that cannot control** (`F4.50` again, during verification).
 *    `CONTROL_unguarded,=1+1` only isolates the formula when the comma is the
 *    delimiter; under TAB or `;` the line is one cell beginning `CONTROL`. Three
 *    of four verification runs were vacuous, and the clean-looking result was
 *    nearly written down. Hence the one-cell control and the `CONTROL_split_*`
 *    rows. **A control is not a control until you have seen it fire in the
 *    configuration you are actually running.**
 */
const CASES: readonly (readonly [string, string])[] = [
  ["plain", "=1+1"],
  ["space_u0020", " =1+1"],
  ["nbsp_u00a0", " =1+1"],
  ["bom_ufeff", "﻿=1+1"],
  ["zwsp_lead", "​ =1+1"],
  ["zwsp_inner", " ​=1+1"],
  ["tab_split", "foo\t=1+1"],
  ["semicolon_split", "foo;=1+1"],
  ["pipe_split", "foo|=1+1"],
];

function buildRows(): CsvField[][] {
  const rows: CsvField[][] = [
    [csvTextCell("case"), csvTextCell("payload")],
    ...CASES.map(([label, payload]) => [csvTextCell(label), csvTextCell(payload)]),
  ];

  // Deliberately bypasses `csvTextCell`. See the anti-vacuity note above: this
  // is the row that proves the parser would have evaluated a formula if the
  // guard had let one through.
  rows.push([csvTextCell("CONTROL_unguarded"), "=1+1" as CsvField]);

  // **A second control, and `F4.50` is why it exists.** The row above only works
  // in a reader that splits on the **comma** — it puts the formula in column 2.
  // Import the same file with TAB or `;` as the delimiter and the whole line
  // stays one cell beginning `CONTROL`, which is trivially not a formula, so the
  // control silently stops controlling. Three of four runs in the `F4.50`
  // verification were vacuous for exactly that reason before this row was added.
  //
  // A **one-cell** row cannot have that problem: whatever the delimiter, there is
  // nothing before the `=`. Use this one whenever the import is not
  // comma-delimited. `csvDocument` emits a single-cell row as a bare line.
  rows.push(["=1+1" as CsvField]);

  // **A third control, answering the question the other two cannot.** Both of
  // the above are *line-leading* formulas: they show that the parser evaluates,
  // not that it **split the field**. Since `F4.50` every payload row above is
  // emitted quoted, so a run where nothing evaluates is equally consistent with
  // "the quoting worked" and "this import mode never split anything" — and only
  // the first of those is a result.
  //
  // These rows are the pre-`F4.50` bytes: raw, unguarded, one separator each. If
  // the import splits on that separator at all, the matching row evaluates. Cast
  // past the brand exactly as `CONTROL_unguarded` does, and for the same reason.
  //
  // **One per separator in the quote trigger, not just the TAB that happened to
  // be tested first** (§4.4). A single TAB control is inert in a `;` import and
  // silently stops controlling — the same shape as the bug that made three of
  // four verification runs vacuous. Read the row that matches your delimiter.
  for (const [label, sep] of [
    ["tab", "\t"],
    ["semicolon", ";"],
    ["pipe", "|"],
  ] as const) {
    rows.push([csvTextCell(`CONTROL_split_${label}`), `foo${sep}=1+1` as CsvField]);
  }
  return rows;
}

function main(): void {
  const outDir = process.argv[2] ?? process.cwd();
  const doc = csvDocument(buildRows());

  const plain = resolve(outDir, "csv-formula-probe.csv");
  const withBom = resolve(outDir, "csv-formula-probe-bom.csv");
  writeFileSync(plain, doc, { encoding: "utf8" });
  writeFileSync(withBom, `﻿${doc}`, { encoding: "utf8" });

  console.error("What csvTextCell did to each payload:\n");
  for (const [label, payload] of CASES) {
    const out = csvTextCell(payload);
    console.error(
      `  ${label.padEnd(14)} in ${JSON.stringify(payload).padEnd(12)} ` +
        `out ${JSON.stringify(out).padEnd(14)} ` +
        `${out === payload ? "UNGUARDED — this is the case under test" : "guarded"}`,
    );
  }

  console.error(`\nWrote:\n  ${plain}\n  ${withBom}`);
  console.error(
    "\nOpen BOTH in Excel, LibreOffice Calc and Google Sheets. Record, per\n" +
      "parser and version, which rows display `2`. CONTROL_unguarded must\n" +
      "display `2` or the run proves nothing. Results belong in ADR 0026's\n" +
      "open question, not only in a commit message.",
  );
}

main();
