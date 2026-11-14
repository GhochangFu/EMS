import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import { repoRoot } from "../testing/repo-root";
import {
  assertFiniteCells,
  energyCsvDocument,
  energySheetRows,
  energyTable,
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
    assetRtuName: "RTU 1",
    assetLocationName: "Plant B",
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
      // `E4.1c` — the fields stopped naming a currency; for a ZAR organization
      // the exported bytes are what they were (`UNCHANGED_OUTPUT` below).
      indicativeCost: 5042.12,
      tariffPerKwh: 2.15,
      currency: "ZAR",
      tariffVerify: false,
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
  "Asset code,Asset,Asset name,Site,Avg kW,Estimated kWh",
  "CH-01,CH-01 · RTU 1,Chiller 1,Plant B,383.57,870.6",
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

  // --- a null PUE (F2.8 ruling 4) --------------------------------------------
  // `pueEstimate` is nullable from `F2.8`: the API returns `null` when no incomer
  // in scope computes `site_kw` and `it_kw`, and there is no fallback curve and no
  // `1` sentinel to write instead. The cell carries **U+2014**, the same glyph
  // `KpiTile` renders for an empty tile — deliberately not U+002D, which is an ADR
  // 0026 formula leader and would arrive apostrophe-guarded as `'-`.
  //
  // The row **label** is unchanged. `UNCHANGED_OUTPUT` above is ADR 0026's
  // byte-level blast-radius proof, and renaming `PUE estimate` would force a
  // re-pin of that golden for no product gain (plan §1).
  const nullPueSummary = { ...preview().summary, pueEstimate: null };
  const nullPueLine = energyCsvDocument(preview({ summary: nullPueSummary }))
    .split("\n")
    .find((line) => line.startsWith("PUE estimate"));
  assert(
    nullPueLine === "PUE estimate,—,",
    `a null pueEstimate must render as the em dash, unquoted and unguarded, got ${JSON.stringify(
      nullPueLine,
    )}`,
  );

  // --- structure ------------------------------------------------------------
  const doc = energyCsvDocument(preview({ topConsumers: [consumer(), consumer({ code: "CH-02" })] }));
  assert(doc.endsWith("\n"), "the document is newline-terminated");
  assert(doc.split("\n\n").length === 4, "three blank-line separated sections plus the header block");
  assert(
    energyCsvDocument(preview({ topConsumers: [] })).endsWith(
      "Asset code,Asset,Asset name,Site,Avg kW,Estimated kWh\n",
    ),
    "with no consumers the table header is still emitted, as it was before the fix",
  );
}

/**
 * `E4.1c` (ADR 0070 decision 7) — a scope with no tariff, or two currencies,
 * answers `null` for the cost, the tariff and the currency. The two cells
 * carry the same U+2014 as a null PUE with an **empty** unit cell (no `ZAR`
 * spelled anywhere — the unit is the organization's), and the sheet path's
 * `assertFiniteCells` does not throw, because a string is outside its type.
 * The row labels are unchanged for the same reason as the PUE row's.
 */
export function assertNullCostRendersTheDash(): void {
  const nullCost = { ...preview().summary, indicativeCost: null, tariffPerKwh: null, currency: null };
  const lines = energyCsvDocument(preview({ summary: nullCost })).split("\n");
  const cost = lines.find((line) => line.startsWith("Indicative cost"));
  const tariff = lines.find((line) => line.startsWith("Tariff"));
  assert(cost === "Indicative cost,—,", `a null cost must be the em dash with an empty unit, got ${JSON.stringify(cost)}`);
  assert(tariff === "Tariff,—,", `a null tariff must be the em dash with an empty unit, got ${JSON.stringify(tariff)}`);
  // Positive control beside the absence: with a currency present the unit cell
  // is the organization's code, which is what the `UNCHANGED_OUTPUT` golden pins
  // for ZAR and what an INR organization gets without a code change.
  const inr = { ...preview().summary, currency: "INR" };
  const inrLines = energyCsvDocument(preview({ summary: inr })).split("\n");
  assert(inrLines.includes("Indicative cost,5042.12,INR"), "the unit cell is the organization's currency");
  assert(inrLines.includes("Tariff,2.15,INR/kWh"), "the tariff unit is the organization's currency per kWh");
  // The sheet path: `assertFiniteCells` is typed on `number` and must not see
  // the string. It throwing here would be the export refusing an honest null.
  const rows = energySheetRows(preview({ summary: nullCost }));
  assert(rows.some((row) => row[0] === "Indicative cost" && row[1] === "—" && row[2] === ""), "the sheet carries the dash and an empty unit");
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
    residual[2] === "foo;=1+1;bar",
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
  assert(numeric[4] === -5, `avgKw must stay a JS number, got ${JSON.stringify(numeric[4])}`);
  assert(numeric[5] === -840, `estimatedKwh must stay a JS number, got ${JSON.stringify(numeric[5])}`);
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

  // --- a null PUE reaches the sheet as text, not as a number (F2.8 ruling 4) --
  // The dash is the one metric cell that is not numeric. It must arrive as a
  // `string` so `aoa_to_sheet` writes `t="str"` rather than a `<v>` the client
  // computes on, and `assertFiniteCells` must let it through — that guard is
  // typed on `number`, so a text cell is outside it by construction. Asserted
  // rather than reasoned, because a `Number.isFinite`-style guard would 500 the
  // xlsx route on exactly the row F2.8 makes reachable.
  const nullPueRows = energySheetRows(
    preview({ summary: { ...preview().summary, pueEstimate: null } }),
  );
  const nullPueRow = nullPueRows.find((row) => row[0] === "PUE estimate");
  assert(
    nullPueRow?.[1] === "—" && typeof nullPueRow[1] === "string",
    `a null pueEstimate must reach the sheet as the string "—", got ${JSON.stringify(
      nullPueRow?.[1],
    )}`,
  );
  assert(
    assertFiniteCells(nullPueRows).length === nullPueRows.length,
    "the finiteness guard must pass a text cell through — it is typed on `number`",
  );
}

// ---------------------------------------------------------------------------
// `F4.303` U12 (ADR 0108 Amendment 6 item 8, owner Q9) — compare on the energy report.
// One claim per exported function; the `.test.ts` wrapper gives each its own `it()`.
// ---------------------------------------------------------------------------

/** `energyTable(preview())` on `main` before `F4.303`, written out so the no-compare path is pinned as an array too. */
const TODAY_TABLE: (string | number)[][] = [
  ["Report", "Energy Consumption"],
  ["Start date", "2026-08-01"],
  ["End date", "2026-08-07"],
  ["Generated at", "2026-08-10T12:00:00.000Z"],
  [],
  ["Metric", "Value", "Unit"],
  ["Total energy", 2345.17, "kWh"],
  ["Peak demand", 414.66, "kW"],
  ["PUE estimate", 1.25, ""],
  ["Indicative cost", 5042.12, "ZAR"],
  ["Tariff", 2.15, "ZAR/kWh"],
  [],
  ["Source", "Energy", "Unit"],
  ["Grid", 2130.37, "kWh"],
  ["Solar", 126.04, "kWh"],
  ["Nominal DG", 88.76, "kWh"],
  [],
  ["Asset code", "Asset", "Asset name", "Site", "Avg kW", "Estimated kWh"],
  ["CH-01", "CH-01 · RTU 1", "Chiller 1", "Plant B", 383.57, 870.6],
];

/** A current period of 120 kWh against a previous one of 100 kWh — the plan's T2 fixture. */
function comparePair(
  nowSummary: Partial<EnergyReportPreview["summary"]> = {},
  beforeSummary: Partial<EnergyReportPreview["summary"]> = {},
): { now: EnergyReportPreview; before: EnergyReportPreview } {
  const now = preview({
    summary: { ...preview().summary, totalKwh: 120, peakKw: 50, pueEstimate: 1.5, indicativeCost: 240, tariffPerKwh: 2, ...nowSummary },
    sourceTotals: { gridKwh: 90, solarKwh: 20, dgKwh: 10 },
  });
  const before = preview({
    range: { startDate: "2026-07-25", endDate: "2026-07-31", durationHours: 168 },
    summary: { ...preview().summary, totalKwh: 100, peakKw: 40, pueEstimate: 1.25, indicativeCost: 200, tariffPerKwh: 2, ...beforeSummary },
    sourceTotals: { gridKwh: 80, solarKwh: 0, dgKwh: 20 },
    topConsumers: [consumer({ code: "OLD-01" }), consumer({ code: "OLD-02" })],
  });
  return { now, before };
}

function rowOf(rows: (string | number)[][], label: string): (string | number)[] | undefined {
  return rows.find((row) => row[0] === label);
}

/** T1 — no second argument is today's array, and an explicit `undefined` is the same. */
export function assertTableWithoutPreviousIsToday(): void {
  const json = JSON.stringify(energyTable(preview()));
  assert(json === JSON.stringify(TODAY_TABLE), `energyTable(preview) must be today's array, got ${json}`);
  assert(
    JSON.stringify(energyTable(preview(), undefined)) === json,
    "energyTable(preview, undefined) must equal energyTable(preview)",
  );
}

/** T2a — the head block gains the `Previous period` row directly after `End date`. */
export function assertHeadBlockGainsThePreviousPeriodRow(): void {
  const { now, before } = comparePair();
  const rows = energyTable(now, before);
  const end = rows.findIndex((row) => row[0] === "End date");
  assert(
    JSON.stringify(rows[end + 1]) === JSON.stringify(["Previous period", "2026-07-25 to 2026-07-31"]),
    `the row after End date must be the previous period, got ${JSON.stringify(rows[end + 1])}`,
  );
}

/** T2b — the metric header is five cells and each metric row carries the previous value and the change. */
export function assertMetricBlockGainsPreviousAndChange(): void {
  const { now, before } = comparePair();
  const rows = energyTable(now, before);
  const expected: (string | number)[][] = [
    ["Metric", "Value", "Unit", "Previous", "Change"],
    ["Total energy", 120, "kWh", 100, 20],
    ["Peak demand", 50, "kW", 40, 25],
    ["PUE estimate", 1.5, "", 1.25, 20],
    ["Indicative cost", 240, "ZAR", 200, 20],
    ["Tariff", 2, "ZAR/kWh", 2, 0],
  ];
  const start = rows.findIndex((row) => row[0] === "Metric");
  const actual = rows.slice(start, start + expected.length);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `the metric block must carry Previous and Change, got ${JSON.stringify(actual)}`,
  );
}

/** T2c — the change is computed on the unrounded values: 120.4 against 100 is 20.4, never 20. */
export function assertChangeReadsTheUnroundedValues(): void {
  const { now, before } = comparePair({ totalKwh: 120.4 });
  const total = rowOf(energyTable(now, before), "Total energy");
  assert(total?.[4] === 20.4, `the change of 120.4 against 100 must be 20.4, got ${JSON.stringify(total?.[4])}`);
}

/** T2d — the source block carries the same two columns; a previous of 0 there is the text. */
export function assertSourceBlockGainsPreviousAndChange(): void {
  const { now, before } = comparePair();
  const rows = energyTable(now, before);
  const expected: (string | number)[][] = [
    ["Source", "Energy", "Unit", "Previous", "Change"],
    ["Grid", 90, "kWh", 80, 12.5],
    ["Solar", 20, "kWh", 0, "no data for the previous period"],
    ["Nominal DG", 10, "kWh", 20, -50],
  ];
  const start = rows.findIndex((row) => row[0] === "Source");
  const actual = rows.slice(start, start + expected.length);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `the source block must carry Previous and Change, got ${JSON.stringify(actual)}`,
  );
}

/** T2e — the top-consumers block is the current period's only, unchanged in width and rows. */
export function assertTopConsumersBlockIsUnchanged(): void {
  const { now, before } = comparePair();
  const tail = (rows: (string | number)[][]) => rows.slice(rows.findIndex((row) => row[0] === "Asset code"));
  const withPrevious = tail(energyTable(now, before));
  assert(
    JSON.stringify(withPrevious) === JSON.stringify(tail(energyTable(now))) && withPrevious.length === 2,
    `the top-consumers block must not change with a previous period, got ${JSON.stringify(withPrevious)}`,
  );
}

/** T3 — a previous period of 0 kWh: the previous value is 0 and the change is the ruling 4.6 sentence. */
export function assertZeroPreviousIsNoData(): void {
  const { now, before } = comparePair({}, { totalKwh: 0 });
  const total = rowOf(energyTable(now, before), "Total energy");
  assert(
    JSON.stringify(total) === JSON.stringify(["Total energy", 120, "kWh", 0, "no data for the previous period"]),
    `a previous of 0 must read "no data for the previous period", got ${JSON.stringify(total)}`,
  );
}

/** T4a — a `null` PUE in the previous period: both new cells are the em dash. */
export function assertNullPreviousPueIsTheDash(): void {
  const { now, before } = comparePair({}, { pueEstimate: null });
  const pue = rowOf(energyTable(now, before), "PUE estimate");
  assert(
    JSON.stringify(pue) === JSON.stringify(["PUE estimate", 1.5, "", "—", "—"]),
    `a null previous PUE must write the dash in both new cells, got ${JSON.stringify(pue)}`,
  );
}

/** T4b — a `null` PUE in the current period: the previous value is kept, the change is the em dash. */
export function assertNullCurrentPueIsTheDash(): void {
  const { now, before } = comparePair({ pueEstimate: null });
  const pue = rowOf(energyTable(now, before), "PUE estimate");
  assert(
    JSON.stringify(pue) === JSON.stringify(["PUE estimate", "—", "", 1.25, "—"]),
    `a null current PUE must write the dash as the value and the change, got ${JSON.stringify(pue)}`,
  );
}

/** T5 — the sheet rows are `energyTable`'s rows with the same previous period. */
export function assertSheetRowsCarryThePreviousPeriod(): void {
  const { now, before } = comparePair();
  const sheet = energySheetRows(now, before);
  assert(
    JSON.stringify(sheet) === JSON.stringify(energyTable(now, before)) && rowOf(sheet, "Previous period") !== undefined,
    "energySheetRows(preview, previous) must be energyTable(preview, previous), Previous period row included",
  );
}

/** T6 — the CSV takes no previous period: `energyCsvDocument` declares one parameter (a source scan). */
export function assertCsvDocumentTakesOneParameter(): void {
  const source = readFileSync(join(repoRoot(), "apps/api/src/reports/reports.serialise.ts"), "utf8");
  const match = /export function energyCsvDocument\(([^)]*)\)/.exec(source);
  assert(match !== null, "energyCsvDocument's declaration must be found — the scan is otherwise vacuous");
  const params = (match?.[1] ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  assert(
    params.length === 1 && params[0] === "preview: EnergyReportPreview",
    `energyCsvDocument must take the preview only (ADR 0108 Amendment 6: the CSV takes no compare), got ${JSON.stringify(params)}`,
  );
}

// ---------------------------------------------------------------------------
// `F4.316` PR 6 (ADR 0111 decision 4) — the top-consumers block keeps "Asset code" and adds
// "Asset", the label `<code> · <RTU>` (else `<code> · <location>`), after it. One claim each.
// ---------------------------------------------------------------------------

function consumerHeader(rows: (string | number)[][]): (string | number)[] | undefined {
  return rows.find((row) => row[0] === "Asset code");
}

/** L1 — the header keeps "Asset code" first and adds "Asset" right after it. */
export function assertConsumerHeaderAddsAssetAfterAssetCode(): void {
  const header = consumerHeader(energyTable(preview()));
  assert(
    JSON.stringify(header) === JSON.stringify(["Asset code", "Asset", "Asset name", "Site", "Avg kW", "Estimated kWh"]),
    `the consumer header must be Asset code, Asset, …, got ${JSON.stringify(header)}`,
  );
}

/** L2 — a consumer under an RTU: the code stays in its own cell, the label is `<code> · <RTU>`. */
export function assertConsumerRowCarriesTheRtuLabel(): void {
  const row = energyTable(preview()).at(-1);
  assert(
    row?.[0] === "CH-01" && row?.[1] === "CH-01 · RTU 1",
    `the consumer row must carry the code and then the label, got ${JSON.stringify(row)}`,
  );
}

/** L3 — the RTU-less twin: the label falls back to the location, `<code> · <location>`. */
export function assertConsumerWithNoRtuIsLabelledByItsLocation(): void {
  const row = energyTable(preview({ topConsumers: [consumer({ assetRtuName: null })] })).at(-1);
  assert(row?.[1] === "CH-01 · Plant B", `an RTU-less consumer must be labelled by its location, got ${JSON.stringify(row?.[1])}`);
}

/**
 * L4 (security) — the label is tenant text (the asset code, an RTU or location display name), so
 * its CSV cell takes the same `csvTextCell` guard as the code: a label led by `=` arrives with the
 * apostrophe, never as a live formula.
 */
export function assertACsvLabelLedByAFormulaLeaderIsGuarded(): void {
  const line = consumerLine({ code: "=1+1", assetRtuName: "RTU 1" });
  const cells = line.split(",");
  assert(
    cells[1] === "'=1+1 · RTU 1",
    `the label cell must be apostrophe-guarded, got ${JSON.stringify(cells[1])} in ${JSON.stringify(line)}`,
  );
}

/** L5 — the sheet path keeps the label verbatim: the writer emits no `<f>`, so an apostrophe would only corrupt it. */
export function assertASheetLabelLedByAFormulaLeaderIsVerbatim(): void {
  const row = energySheetRows(preview({ topConsumers: [consumer({ code: "=1+1" })] })).at(-1);
  assert(row?.[1] === "=1+1 · RTU 1", `the sheet's label cell must be verbatim, got ${JSON.stringify(row?.[1])}`);
}
