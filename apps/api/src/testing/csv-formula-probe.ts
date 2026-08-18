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
 * - `CONTROL_unguarded` **must** display `2`. It bypasses the guard on purpose.
 *   If it does not, that parser does not evaluate CSV formulas at all and the
 *   whole run proves nothing — this is the anti-vacuity check, and without it
 *   "nothing evaluated" is indistinguishable from "nothing could have".
 * - `plain` must not. That is the shipped guard working.
 * - `space_u0020`, `nbsp_u00a0`, `bom_ufeff` are the question. **If any displays
 *   `2`, that is a live vulnerability in shipped code** — widen `FORMULA_LEADERS`
 *   and add a test. If none does, record the negative result in ADR 0026 with
 *   the parser name and version.
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
 * - `tab_split` / `semicolon_split` — a different class: not formula *detection*
 *   but **field splitting**. TAB is in `FORMULA_LEADERS` yet not in the quote
 *   trigger, and `;` is in neither, so both are emitted unquoted. Any consumer
 *   treating either as a delimiter — a clipboard paste into Excel, LibreOffice
 *   sticky separator checkboxes, or Excel opening a .csv in a locale whose list
 *   separator is `;` — gets a second cell beginning `=`. Both are
 *   **pre-existing**, not introduced by the trimming fix.
 *
 * A row here is a question, not a claim. Put the answer in ADR 0026.
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
