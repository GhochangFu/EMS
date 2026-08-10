import type { EnergyReportPreview, EnergyTopConsumer } from "@bms/shared";

import { energyCsvDocument } from "./reports.serialise";

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
  assert(
    energyCsvDocument(preview({ topConsumers: [consumer({ siteName: "\rPlant B" })] })).split("\n")
      .length === UNCHANGED_OUTPUT.split("\n").length,
    "a CR inside a cell must not add a physical line to the document",
  );

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
