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
