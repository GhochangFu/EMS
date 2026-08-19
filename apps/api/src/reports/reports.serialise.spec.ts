import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import {
  assertFiniteCells,
  energyCsvDocument,
  energySheetRows,
} from "./reports.serialise";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Written out literally, not imported — see the note in `csv.spec.ts`. */
const LEADERS = ["=", "+", "-", "@", "\t", "\r"];

function consumer(overrides: Partial<EnergyTopConsumer> = {}): EnergyTopConsumer {
  return {
    assetId: "00000000-0000-4000-8000-000000000001",
    code: "CH-01",
    name: "Chiller 1",
    siteName: "Plant B",
    avgKw: 383.57,
    estimatedKwh: 870.6,
    ...overrides,
  };
}

function preview(overrides: Partial<EnergyReportPreview> = {}): EnergyReportPreview {
  return {
    template: {
      id: "energy_consumption",
      title: "Energy Consumption",
      description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
      formats: ["CSV"],
      active: true,
    },
    range: { startDate: "2026-08-01", endDate: "2026-08-07", durationHours: 168 },
    generatedAt: "2026-08-10T12:00:00.000Z",
    summary: {
      window: "custom",
      totalKwh: 2345.17,
      peakKw: 414.66,
      pueEstimate: 1.25,
      indicativeCostZar: 5042.12,
      tariffZarPerKwh: 2.15,
      asOf: "2026-08-10T12:00:00.000Z",
    },
    sourceTotals: { gridKwh: 2130.37, solarKwh: 126.04, dgKwh: 88.76 },
    topConsumers: [consumer()],
    notes: [],
    ...overrides,
  };
}

/**
 * The exact bytes `energyCsv` produced **before** ADR 0026, for a preview whose
 * strings are all benign.
 *
 * This is the fix's blast-radius proof. No asset in the database carries a formula
 * leader or a quoting character today (0 of 148 on all three columns, ADR 0026
 * fact 3), so the guard must be a **no-op on real data** — and "output identical"
 * is otherwise indistinguishable from "change not deployed", which is the failure
 * `F4.28` actually hit. Pinning the bytes makes the difference checkable.
 */
const UNCHANGED_OUTPUT = [
  "Report,Energy Consumption",
  "Start date,2026-08-01",
  "End date,2026-08-07",
  "Generated at,2026-08-10T12:00:00.000Z",
  "",
  "Metric,Value,Unit",
  "Total energy,2345.17,kWh",
  "Peak demand,414.66,kW",
  "PUE estimate,1.25,",
  "Indicative cost,5042.12,ZAR",
  "Tariff,2.15,ZAR/kWh",
  "",
  "Source,Energy,Unit",
  "Grid,2130.37,kWh",
  "Solar,126.04,kWh",
  "Nominal DG,88.76,kWh",
  "",
  "Asset code,Asset name,Site,Avg kW,Estimated kWh",
  "CH-01,Chiller 1,Plant B,383.57,870.6",
  "",
].join("\n");

/** The last data line of the document — the top-consumers row. */
function consumerLine(overrides: Partial<EnergyTopConsumer>): string {
  const lines = energyCsvDocument(preview({ topConsumers: [consumer(overrides)] })).split("\n");
  // Trailing newline means the final element is empty; the row is the one before.
  return lines[lines.length - 2] as string;
}

/** ADR 0026 — the Energy Consumption CSV export. */
export function runReportsSerialiseTests(): void {
  // --- benign data is byte-for-byte what it was before the fix ---------------
  assert(
    energyCsvDocument(preview()) === UNCHANGED_OUTPUT,
    "the guard must not alter the export for data that needs no guarding; if this fails, either " +
      "the escaping regressed or the report's layout changed and this golden needs updating " +
      "deliberately, not reflexively",
  );

  // --- formula injection in the three untrusted cells ------------------------
  // `code`, `name` and `siteName` are the only cells a human types (ADR 0026 fact
  // 1), and neither write path into `bms.assets` restricts their characters
  // (fact 2). This is the assertion that would have caught the original defect:
  // before the fix these arrived as live formulas.
  for (const lead of LEADERS) {
    const payload = `${lead}cmd|' /c calc'!A1`;
    for (const column of ["code", "name", "siteName"] as const) {
      const line = consumerLine({ [column]: payload });
      assert(
        !line.includes(`,${lead}cmd`) && !line.includes(`,"${lead}cmd`) && !line.startsWith(lead),
        `a ${column} of ${JSON.stringify(lead)}cmd… must not reach the cell as a formula`,
      );
      assert(
        line.includes(`'${lead}cmd`),
        `the ${column} value must still be delivered, neutralised rather than stripped`,
      );
    }
  }

  // --- the coupled defect (ADR 0026 fact 4) ---------------------------------
  // The old trigger was /["\n,]/, so a CR-led value would have been guarded to
  // `'\rfoo` and emitted UNQUOTED — splitting the record. Adding the apostrophe
  // without widening the trigger would have shipped a new defect on top of the fix.
  const crLine = consumerLine({ siteName: "\rPlant B" });
  assert(
    crLine.includes('"\'\rPlant B"'),
    "a CR-led site name must be quoted as well as guarded, or the row splits in two",
  );
  // There WAS a second assertion here comparing `split("\n").length` against the
  // benign document's, described as proving "a CR does not add a physical line".
  // It was **invariant under the mutation it claimed to guard** — the compliance
  // review caught it. Narrow the trigger back to `/["\n,]/` and the cell emits
  // `'\rPlant B` bare, but a lone CR contains no LF, so the JS line count is
  // identical and the assertion passes. It restated the implementation and read as
  // stronger than it was. The `crLine` check above is what actually kills that
  // mutation; this note stays because ADR 0025 decision 5b makes a vacuous test
  // this repo's recurring defect, and deleting it silently would lose the third
  // instance. Removed rather than repaired, as F4.28's tautology was.
  //
  // A CSV *parser* is what would split on the bare CR, and a real record-count
  // assertion would need one here. The quoting check is the cheaper equivalent.

  // --- ordinary quoting still works -----------------------------------------
  assert(
    consumerLine({ name: "Pump, main" }).includes('"Pump, main"'),
    "a comma in an asset name forces quoting",
  );
  assert(
    consumerLine({ name: 'said "no"' }).includes('"said ""no"""'),
    "embedded quotes are doubled",
  );
  assert(
    consumerLine({ siteName: "Plant B - West" }).includes("Plant B - West"),
    "an interior dash is not a leader and must not be quoted or guarded",
  );

  // --- numbers stay numbers (ADR 0026 decision 2) ---------------------------
  // A negative kW is the case that matters. `kw` has no negative rows today but
  // `kvar` has 750 (fact 8), and a bidirectional meter on the PHE pilot could send
  // one — at which point an apostrophe would make the client's spreadsheet treat
  // the cell as text and their own arithmetic on it would silently stop working.
  const negative = consumerLine({ avgKw: -5, estimatedKwh: -840 });
  assert(negative.endsWith(",-5,-840"), `negative numbers render bare, got ${negative}`);
  assert(!negative.includes("'-"), "no apostrophe reaches a numeric cell");

  // --- structure ------------------------------------------------------------
  const doc = energyCsvDocument(preview({ topConsumers: [consumer(), consumer({ code: "CH-02" })] }));
  assert(doc.endsWith("\n"), "the document is newline-terminated");
  assert(doc.split("\n\n").length === 4, "three blank-line separated sections plus the header block");
  assert(
    energyCsvDocument(preview({ topConsumers: [] })).endsWith(
      "Asset code,Asset name,Site,Avg kW,Estimated kWh\n",
    ),
    "with no consumers the table header is still emitted, as it was before the fix",
  );
}

/**
 * ADR 0026 Amendment 2 (`F4.51`) — the XLSX path.
 *
 * `F4.51` measured that no cell-level escaping in `csv.ts` closes the
 * multi-separator injection against a consumer that does not treat the comma as a
 * delimiter: with two separators the closing `"` lands on a later fragment and the
 * middle one is bare. The owner ruled option (c)+(a) — offer the format where the
 * class does not exist, and document the CSV residual rather than pretend it is
 * closed.
 *
 * **The safety property belongs to the writer, not to this function.**
 * `aoa_to_sheet` emits no `<f>` element, so nothing in the file instructs Excel to
 * evaluate anything; `audit.serialise.ts` carries the measured proof and warns
 * against re-deriving it from the cell type, which is `t="str"` and does not mean
 * what it looks like. These rows are therefore deliberately **unguarded**, and the
 * assertions below pin that intent so nobody "completes" the fix by adding
 * apostrophes that would corrupt the operator's data to buy nothing.
 */
export function runReportsSheetTests(): void {
  const cellsOf = (rows: (string | number)[][]): (string | number)[] =>
    rows[rows.length - 1] as (string | number)[];

  // --- the three untrusted cells arrive verbatim -----------------------------
  for (const lead of LEADERS) {
    const payload = `${lead}1+1`;
    for (const column of ["code", "name", "siteName"] as const) {
      const row = cellsOf(energySheetRows(preview({ topConsumers: [consumer({ [column]: payload })] })));
      assert(
        row.includes(payload),
        `a ${column} of ${JSON.stringify(payload)} must reach the sheet verbatim — the writer ` +
          `emits no <f> element, so an apostrophe here corrupts data and closes nothing`,
      );
    }
  }

  // --- the residual payload, which is the reason this format exists ----------
  // `"foo;=1+1;bar"` is the exact shape `F4.51` measured evaluating in Excel 2013
  // when the file is opened with `;` as the only delimiter: it imports as
  // `"foo` · `=1+1` → 2 · `bar"`. Here it is one cell and cannot fragment, because
  // the field boundary is the XML element rather than a character the consumer
  // chooses. That is the whole difference between the two formats.
  const residual = cellsOf(energySheetRows(preview({ topConsumers: [consumer({ name: "foo;=1+1;bar" })] })));
  assert(
    residual[1] === "foo;=1+1;bar",
    "the multi-separator payload must occupy exactly one cell — the property no CSV escaping gives",
  );

  // --- numbers stay numbers (ADR 0026 decision 2, carried into the new format)
  // `audit.serialise.ts` returns `string[][]` because no audit column is one the
  // client computes on. Every numeric column here is. Emitting these as strings
  // would write `t="str"` and silently break the client's arithmetic — the same
  // harm decision 2 forbids the apostrophe guard from causing in the CSV, arriving
  // by a different route. A negative value is the case that matters: `kvar` has 750
  // negative rows today (ADR 0026 fact 8).
  const numeric = cellsOf(energySheetRows(preview({ topConsumers: [consumer({ avgKw: -5, estimatedKwh: -840 })] })));
  assert(numeric[3] === -5, `avgKw must stay a JS number, got ${JSON.stringify(numeric[3])}`);
  assert(numeric[4] === -840, `estimatedKwh must stay a JS number, got ${JSON.stringify(numeric[4])}`);
  assert(
    !numeric.some((cell) => typeof cell === "string" && cell.startsWith("'")),
    "no apostrophe reaches any cell in the sheet path",
  );
  const summary = energySheetRows(preview());
  assert(
    summary.some((row) => row[0] === "Total energy" && row[1] === 2345.17),
    "the metric block must carry its numbers as numbers, not as formatted text",
  );

  // --- the sheet layout ------------------------------------------------------
  // There WAS a row-count assertion here — `sheetRows.length === csvLines.length
  // - 1` — under a comment claiming it caught the two documents drifting apart.
  // **It was vacuous, and the comment described code this change deleted.** The
  // first draft did build two separate literal lists; the shipped version renders
  // both from one `energyTable`, so the counts are structurally equal and the
  // assertion could not fail. Removed rather than repaired, exactly as the CR
  // line-count assertion above was, and for the same reason: ADR 0025 decision 5b
  // makes a test that is invariant under the mutation it names this repo's
  // recurring defect, and deleting it silently would lose the instance.
  //
  // What actually guards the drift is the single `energyTable`, which is
  // structure rather than a test. What guards the *rendering* of it is the
  // numeric-cell pair below — **and the first version of this note named the
  // wrong test.** It claimed the `UNCHANGED_OUTPUT` golden catches a flipped
  // `typeof cell === "number"` ternary. It does not: every number in that golden
  // is positive, and `2345.17` renders byte-identically through `csvTextCell` and
  // `csvNumberCell` alike, so the golden passes under that mutation. Measured, not
  // reasoned — the ternary was flipped to `csvTextCell(String(cell))` and the run
  // failed at `negative numbers render bare` (line 166) with the golden green.
  // The negative case is load-bearing precisely because `-` is a formula leader,
  // which is the same reason ADR 0026 fact 8 gives for keeping it.
  // The assertions below pin content, not counts, so they still bite.
  const sheetRows = energySheetRows(preview());

  // --- the finiteness guard, raised by the `F4.51` security review -----------
  // `csvNumberCell` throws on a non-finite value and `csv.ts` explains why that
  // throw stays live after migration `0031`. The sheet path reached no such check,
  // so on one bad row the CSV route 500'd and the xlsx route wrote
  // `<v>NaN</v>` — a numeric cell whose value is not a valid `xsd:double`.
  let threw = false;
  try {
    assertFiniteCells([["Total energy", Number.NaN, "kWh"]]);
  } catch {
    threw = true;
  }
  assert(threw, "a non-finite numeric cell must throw before it reaches the xlsx writer");
  // The control. Without it the assertion above passes on a function that always
  // throws, which would break every export.
  assert(
    assertFiniteCells([["Peak demand", -5, "kW"]]).length === 1,
    "a finite table must pass through unchanged, negatives included",
  );
  assert(
    sheetRows[0]?.[0] === "Report" && sheetRows[0]?.[1] === "Energy Consumption",
    "the header block leads the sheet exactly as it leads the CSV",
  );
  assert(
    energySheetRows(preview({ topConsumers: [] })).at(-1)?.[0] === "Asset code",
    "with no consumers the table header is still emitted, matching the CSV",
  );
}
