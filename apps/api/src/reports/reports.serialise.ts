import type { EnergyReportPreview } from "@bms/shared";

import { csvDocument, csvNumberCell, csvTextCell } from "../serialise/csv";
import type { CsvField } from "../serialise/csv";

/**
 * Export serialisation for the Energy Consumption report (ADR 0026).
 *
 * Lifted out of `ReportsService.energyCsv`, which built its rows inline and could
 * therefore only be tested with a live `Pool`. It never was: `F4.28` gave
 * `reports.service.ts` its first coverage but through `energyPreview` only, so
 * before `F4.29` this serialisation had **never been executed by a test**
 * (ADR 0026 fact 5). Pure and `Pool`-free here, mirroring `audit.serialise.ts`.
 *
 * **Three cells carry values a human typed** — `code`, `name` and `siteName` in
 * the top-consumers block. Everything else is a literal in this file, a
 * Zod-validated `YYYY-MM-DD`, an ISO timestamp this process produced, or a number.
 *
 * **The write paths that reach those three are wider than this comment used to
 * claim, and the correction matters.** It said "neither write path into
 * `bms.assets`" and cited two files with line numbers that have since moved.
 * `F4.51` enumerated them: `assets.schema.ts`, `asset-templates.schema.ts`,
 * `asset-templates-content.schema.ts` and `onboarding.schema.ts` all write
 * `code`/`name`/`siteName`, and every one validates length only. The
 * undercount is why `F4.51` rejected option (b) — see *Two documents, one
 * table* below. Do not re-narrow this sentence to a file count; it will drift
 * again. The property that matters is that **no write path restricts the
 * characters**, and that is still true.
 *
 * ## Two documents, one table
 *
 * ADR 0026 Amendment 2 (`F4.51`) added the XLSX export. The reason is a defect
 * the CSV cannot fix at any escaping layer: for a consumer that does not treat
 * the comma as a delimiter, a cell holding **two or more** separators splits so
 * that the closing `"` lands on a later fragment and the middle one arrives bare
 * and evaluates. Measured on Excel 2013: `"foo;=1+1;bar"` opened with `;` alone
 * imports as `"foo` · `=1+1` → 2 · `bar"`. Guarding every fragment would mean
 * inserting apostrophes into the operator's own data and would break the correct
 * comma reader — a worse trade than the defect, so the CSV keeps its documented
 * residual and the sheet is offered beside it.
 *
 * The two renderers therefore share `energyTable`. They were separate literal
 * lists in the first draft of this change and could drift apart silently while
 * the client is told they are one report in two formats.
 *
 * The `string`/`number` split in `ReportCell` carries ADR 0026 decision 2's
 * exemption one level up, and it keeps numeric cells numeric in the sheet as
 * well, where writing them as text would set `t="str"` and silently break the
 * client's arithmetic.
 *
 * **It is a weaker mechanism than what it replaced, and the `F4.51` security
 * review was right to name it.** `csv.ts` states the rule as "a separate
 * function, taking `number`, so that **the compiler** decides which cells are
 * exempt". The old shape wrapped every cell at the literal, so a wrong type was
 * a compile error; `energyCsvDocument` now re-derives the choice from a runtime
 * `typeof`.
 *
 * Two things this is **not**. It is not the regex-on-produced-output pattern ADR
 * 0026 rejected: a numeric-looking *string* still routes to `csvTextCell` and is
 * still guarded. And the unsafe direction is unreachable — `typeof` cannot send a
 * string to `csvNumberCell`. The residual risk is defence in depth: a future cell
 * typed `unknown`, or reached through a cast, gets no compile error where the old
 * shape demanded an explicit wrap. Accepted rather than restructured, because
 * branding the table would buy that back at the cost of the single source of
 * truth this refactor exists to create. Recorded so the trade is visible.
 */

/** A cell before either renderer sees it: a `string` is text, a `number` is numeric. */
type ReportCell = string | number;

/**
 * The report as a table: a header block, a metric block, a source block, and the
 * top-consumers table, separated by blank rows.
 */
function energyTable(preview: EnergyReportPreview): ReportCell[][] {
  return [
    ["Report", preview.template.title],
    ["Start date", preview.range.startDate],
    ["End date", preview.range.endDate],
    ["Generated at", preview.generatedAt],
    [],
    ["Metric", "Value", "Unit"],
    // Numbers stay `number` here and take `csvNumberCell` below, which does NOT
    // apostrophe-guard — Excel's formula reading of `-5` is -5, so guarding would
    // import these as text and break the client's arithmetic (ADR 0026 decision 2).
    // The cell type is what enforces the split; there is no regex deciding it.
    ["Total energy", preview.summary.totalKwh, "kWh"],
    ["Peak demand", preview.summary.peakKw, "kW"],
    ["PUE estimate", preview.summary.pueEstimate, ""],
    ["Indicative cost", preview.summary.indicativeCostZar, "ZAR"],
    ["Tariff", preview.summary.tariffZarPerKwh, "ZAR/kWh"],
    [],
    ["Source", "Energy", "Unit"],
    ["Grid", preview.sourceTotals.gridKwh, "kWh"],
    ["Solar", preview.sourceTotals.solarKwh, "kWh"],
    ["Nominal DG", preview.sourceTotals.dgKwh, "kWh"],
    [],
    ["Asset code", "Asset name", "Site", "Avg kW", "Estimated kWh"],
    ...preview.topConsumers.map((consumer): ReportCell[] => [
      // The three untrusted cells.
      consumer.code,
      consumer.name,
      consumer.siteName,
      consumer.avgKw,
      consumer.estimatedKwh,
    ]),
  ];
}

/**
 * The report as CSV. Escaped and apostrophe-guarded per ADR 0026.
 *
 * The bytes are pinned by a golden in `reports.serialise.spec.ts`, because
 * "output identical" is otherwise indistinguishable from "change not deployed".
 */
export function energyCsvDocument(preview: EnergyReportPreview): string {
  const rows: CsvField[][] = energyTable(preview).map((row) =>
    row.map((cell): CsvField =>
      typeof cell === "number" ? csvNumberCell(cell) : csvTextCell(cell),
    ),
  );
  return csvDocument(rows);
}

/**
 * Throws unless every numeric cell is finite. Raised by the `F4.51` security
 * review as an asymmetry, and it was real.
 *
 * `csvNumberCell` throws on a non-finite value and `csv.ts` documents at length
 * why that throw stays live after migration `0031`: it still covers a bad cast
 * past the erased brand, and a database that has not run `0031` yet.
 * `energySheetRows` returns the raw table, so the sheet path reached no such
 * check — on the same row the CSV route failed loudly with a 500 while the XLSX
 * route wrote `<c r="B1"><v>NaN</v></c>`, a numeric cell whose `<v>` is not a
 * valid `xsd:double`. What Excel does with that was **not** measured; the
 * asymmetry is what is evidenced, and one of the two behaviours is wrong
 * whichever way Excel resolves it.
 *
 * Applied in `energyXlsx` rather than inside `energySheetRows`, so the shaping
 * function stays pure and the spec can exercise it without a throw.
 */
export function assertFiniteCells(rows: ReportCell[][]): ReportCell[][] {
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell === "number" && !Number.isFinite(cell)) {
        throw new Error(`Non-finite value in the energy report: ${String(cell)}`);
      }
    }
  }
  return rows;
}

/**
 * The report as rows for `xlsx`. **Deliberately unguarded and unescaped.**
 *
 * The safety is structural and belongs to the writer, not to this function:
 * `aoa_to_sheet` writes no `<f>` element, so nothing in the file instructs Excel
 * to evaluate anything. `audit.serialise.ts` carries the measurement, including
 * the warning not to re-derive it from the cell type — `t="str"` is ECMA-376's
 * *cached formula result* type and does not mean what it looks like.
 *
 * So an apostrophe here would corrupt the operator's data and close nothing. The
 * spec pins that intent rather than leaving it to a comment.
 */
export function energySheetRows(preview: EnergyReportPreview): ReportCell[][] {
  return energyTable(preview);
}
