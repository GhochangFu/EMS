import { csvDocument, csvNumberCell, csvTextCell } from "./csv";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The formula leaders, written out **literally**.
 *
 * Not imported from `csv.ts` on purpose, and the audit spec has done the same
 * since `F4.14`: a test that reads the constant it is checking passes just as
 * happily after someone deletes an entry from it.
 */
const LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/** ADR 0026 — the shared CSV escaping rule. */
export function runCsvSerialiseTests(): void {
  // --- ordinary text is untouched -------------------------------------------
  assert(csvTextCell("CH-01") === "CH-01", "a plain value passes through unchanged");
  assert(csvTextCell("") === "", "an empty cell stays empty");
  assert(csvTextCell("reduced by 5") === "reduced by 5", "an interior digit is not a leader");
  assert(csvTextCell("Plant B - West") === "Plant B - West", "an interior dash is not a leader");

  // --- quoting ---------------------------------------------------------------
  assert(csvTextCell("Pump, main") === '"Pump, main"', "a comma forces quoting");
  assert(csvTextCell('said "no"') === '"said ""no"""', "embedded quotes are doubled");
  assert(csvTextCell("line one\nline two") === '"line one\nline two"', "LF forces quoting");
  assert(csvTextCell("a\r\nb") === '"a\r\nb"', "CRLF forces quoting");

  // --- formula injection ----------------------------------------------------
  for (const lead of LEADERS) {
    const payload = `${lead}cmd|' /c calc'!A1`;
    const cell = csvTextCell(payload);
    assert(
      !cell.startsWith(lead) && !cell.startsWith(`"${lead}`),
      `leading ${JSON.stringify(lead)} must not survive as the first character of the cell`,
    );
    assert(
      cell.includes(`'${lead}cmd`),
      `leading ${JSON.stringify(lead)} is neutralised by an apostrophe, not stripped — the value ` +
        "still has to reach the reader",
    );
  }

  // --- leading whitespace before a leader (F4.31) ---------------------------
  //
  // **A measured bypass, not a hypothetical.** ADR 0026 left this an open
  // question and declined to guess. `F4.31` ran the file through the three
  // parsers, and **Google Sheets evaluated `" =1+1"` to `2`** — one leading
  // U+0020 space, stripped by the importer, formula evaluated underneath. The
  // unguarded control in the same file also evaluated, so the result is real
  // rather than an artifact of the import settings.
  //
  // These cases go well past the one payload that was tested, deliberately
  // (§4.4: fix the class, not the instance). Adding `" "` to FORMULA_LEADERS
  // would have closed exactly the probe's own example and nothing else.
  const WHITESPACE_LEADS = [
    [" ", "U+0020 space — the measured Sheets bypass"],
    [" ", "U+00A0 no-break space — safe in Sheets, guarded anyway"],
    ["﻿", "U+FEFF BOM — safe in Sheets, guarded anyway"],
    ["  ", "two spaces — never tested in a parser, and must not need to be"],
    ["  ﻿ ", "a mixed run of all three"],
  ] as const;

  // Only the four NON-whitespace leaders here, and the exclusion is a finding
  // rather than a convenience. TAB and CR are leaders *and* whitespace, so
  // `" \t1+1"` trims to `"1+1"` — text, not a formula — and guarding it would be
  // guarding nothing. The first version of this loop ran all six and failed on
  // exactly that case, which is how the distinction got noticed.
  const NON_WHITESPACE_LEADERS = ["=", "+", "-", "@"] as const;

  for (const [prefix, why] of WHITESPACE_LEADS) {
    for (const lead of NON_WHITESPACE_LEADERS) {
      const cell = csvTextCell(`${prefix}${lead}1+1`);
      assert(
        cell.startsWith("'") || cell.startsWith(`"'`),
        `${why}: ${JSON.stringify(prefix + lead)} must be guarded, got ${JSON.stringify(cell)}`,
      );
    }
  }

  // Whitespace *through* a whitespace leader and onto a real one still guards —
  // the case the loop above cannot express.
  //
  // **Only payloads whose first character is NOT itself a leader.** The security
  // review caught `"\t =1+1"` sitting in this list: it starts with TAB, so the
  // *raw* check already catches it and it survives deleting the trimmed check
  // entirely — it looked like it discriminated and did not. These two do.
  //
  // Asserted with `startsWith`, not `includes("'")`. The weaker form was the
  // review's other catch: it passes on any value that merely *contains* an
  // apostrophe anywhere.
  for (const payload of [" \t=1+1", " \r@SUM(1)"]) {
    const cell = csvTextCell(payload);
    assert(
      cell.startsWith("'") || cell.startsWith(`"'`),
      `${JSON.stringify(payload)} reaches a formula leader after trimming and must be guarded, ` +
        `got ${JSON.stringify(cell)}`,
    );
  }

  // The value still has to survive intact — the guard neutralises, it does not
  // sanitise. An operator whose asset name genuinely begins with a space must
  // read it back unchanged.
  assert(
    csvTextCell(" =1+1") === "' =1+1",
    "the whitespace and the payload both survive the guard",
  );

  // **The raw check still fires where the trimmed one does not**, so keep it —
  // but the claim is narrower than the first version of this comment made it,
  // and the security review was right to say so. TAB and CR are leaders *and*
  // whitespace, so they trim to the empty string; the raw check is therefore
  // uniquely load-bearing for values like `"\t"`, `"\r"` and `"\tfoo"` — **none
  // of which carries a formula body**. `"\t=1+1"` is caught by the *trimmed*
  // check. So dropping the raw test would be a behaviour change and a
  // departure from OWASP's stated rule, not an exploitable regression. Kept
  // because it is free and correct, not because it is the thing holding the
  // vulnerability shut.
  for (const lone of ["\t", "\r"]) {
    const cell = csvTextCell(lone);
    assert(
      cell.includes(`'${lone}`),
      `a lone ${JSON.stringify(lone)} must still be guarded — it trims to the empty string`,
    );
  }

  // Whitespace with no leader under it is ordinary text and must not be touched.
  assert(csvTextCell("  Pump A") === "  Pump A", "indented text is not a formula");
  assert(csvTextCell(" ") === " ", "a lone space is not a formula");

  // --- separators other than the comma (F4.50) ------------------------------
  //
  // **Measured, not defensive.** Excel 2013 evaluated `=1+1` out of an unquoted
  // cell in four consumers that do not read the file as comma-delimited: a
  // clipboard paste under a TAB delimiter, the same under `;`, a file open with
  // comma+TAB (LibreOffice's separator checkboxes are sticky), and a file open
  // with `;` only (Excel double-click in a `;`-list-separator locale). The
  // anti-vacuity control evaluated in every run.
  //
  // Written out **literally**, like LEADERS above and for the same reason: a
  // test that imports `QUOTE_TRIGGER` still passes after someone narrows it.
  const SEPARATORS = [
    [",", "RFC 4180 — the delimiter we actually emit"],
    ["\t", "TAB — a clipboard paste, and LibreOffice's sticky checkbox"],
    [";", "semicolon — Excel double-click in a ;-list-separator locale"],
    ["|", "pipe — LibreOffice offers it in the same dialog"],
  ] as const;

  for (const [sep, why] of SEPARATORS) {
    const cell = csvTextCell(`foo${sep}=1+1`);
    assert(
      cell === `"foo${sep}=1+1"`,
      `${why}: ${JSON.stringify(`foo${sep}=1+1`)} must be quoted, got ${JSON.stringify(cell)}`,
    );
  }

  // The rule is about the **separator**, not about the payload behind it. An
  // ordinary asset name containing a semicolon quotes too — that is the byte
  // change this cost, and it was 0 rows on 2026-08-18.
  assert(
    csvTextCell("Chiller 1; Bay 2") === '"Chiller 1; Bay 2"',
    "a semicolon quotes even with nothing dangerous after it",
  );

  // **Two separators in one cell, and this is the residual `F4.51` names.**
  // Asserted so the emitted bytes are pinned, NOT because the outcome is safe.
  // A reader who imports this file without the comma as a delimiter splits the
  // cell into `"a`, `=1+1`, `b`, `c"` — and the middle fragment is a bare
  // formula that **Excel 2013 evaluated to 2**. The closing quote only lands on
  // the formula when the cell holds exactly one separator, which is the whole
  // reason the first write-up of `F4.50` wrongly called those consumers
  // "mitigated". Nothing `csvTextCell` can do fixes this: the apostrophe guard
  // protects the first fragment only.
  assert(
    csvTextCell("a;=1+1;b;c") === '"a;=1+1;b;c"',
    "a multi-separator cell is quoted — which is all this module can do about it",
  );

  // **Space is deliberately NOT a trigger**, and this asserts the exclusion so
  // that nobody "completes" the list by adding it. LibreOffice offers space in
  // the same dialog, but quoting on it would quote nearly every cell this app
  // emits. The class "separator some consumer might pick" has no bound; the
  // list above is the separators that are default-offered *and* absent from our
  // data, which is a different and defensible claim.
  assert(csvTextCell("Pump A =1+1") === "Pump A =1+1", "a space must not force quoting");

  // --- the coupled defect (ADR 0026 fact 4) ---------------------------------
  // A value *starting* with CR is guarded to `'\rfoo`, which still contains a CR.
  // `reports.service.ts` quoted on /["\n,]/ only, so before this fix the guarded
  // form would have been emitted bare and split the record — a NEW defect shipped
  // on top of the old one. This is the assertion that would have caught it.
  const crLed = csvTextCell("\r=1+1");
  assert(crLed.startsWith('"') && crLed.endsWith('"'), "a CR-led value must be quoted, not bare");
  assert(crLed === '"\'\r=1+1"', "a CR-led value is both guarded and quoted");

  // --- numbers are exempt, structurally (ADR 0026 decision 2) ---------------
  assert(csvNumberCell(2345.17) === "2345.17", "a positive number renders as itself");
  assert(csvNumberCell(0) === "0", "zero renders as itself");
  // The one case that matters: `-` is a formula leader, and a number must NOT be
  // guarded anyway, because Excel's formula reading of `-5` IS -5. Guarding would
  // import the cell as text and break arithmetic on the client's own sheet.
  assert(csvNumberCell(-5) === "-5", "a negative number is NOT apostrophe-guarded");
  assert(csvNumberCell(-0.83) === "-0.83", "nor is a negative fraction (kvar's measured range)");
  assert(!csvNumberCell(-5).startsWith("'"), "no apostrophe reaches a numeric cell");

  // --- non-finite is a defect, not a cell (decision 5) ----------------------
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    let threw = false;
    try {
      csvNumberCell(bad);
    } catch {
      threw = true;
    }
    assert(threw, `csvNumberCell(${String(bad)}) must throw rather than emit a cell`);
  }

  // --- document shape -------------------------------------------------------
  const doc = csvDocument([
    [csvTextCell("Metric"), csvTextCell("Value")],
    [csvTextCell("Total energy"), csvNumberCell(695.37)],
  ]);
  assert(doc === "Metric,Value\nTotal energy,695.37\n", "rows are LF-joined and newline-terminated");
  assert(csvDocument([]) === "\n", "an empty document is a bare newline");
  assert(
    csvDocument([[csvTextCell("a")], [], [csvTextCell("b")]]) === "a\n\nb\n",
    "an empty row emits a blank line — the reports export uses them as section breaks",
  );
}
