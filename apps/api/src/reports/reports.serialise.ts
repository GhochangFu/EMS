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
 * Neither write path into `bms.assets` restricts characters on those three
 * (`asset-templates.schema.ts:98`–`100`, `onboarding.schema.ts:63`–`67` validate
 * length only), so they are the reason this file exists.
 */

/**
 * The report as CSV: a header block, a metric block, a source block, and the
 * top-consumers table, separated by blank lines.
 */
export function energyCsvDocument(preview: EnergyReportPreview): string {
  const rows: CsvField[][] = [
    [csvTextCell("Report"), csvTextCell(preview.template.title)],
    [csvTextCell("Start date"), csvTextCell(preview.range.startDate)],
    [csvTextCell("End date"), csvTextCell(preview.range.endDate)],
    [csvTextCell("Generated at"), csvTextCell(preview.generatedAt)],
    [],
    [csvTextCell("Metric"), csvTextCell("Value"), csvTextCell("Unit")],
    // Numbers take `csvNumberCell`, which does NOT apostrophe-guard — Excel's
    // formula reading of `-5` is -5, so guarding would import these as text and
    // break the client's arithmetic (ADR 0026 decision 2). The parameter types are
    // what enforce the split; there is no regex deciding it.
    [csvTextCell("Total energy"), csvNumberCell(preview.summary.totalKwh), csvTextCell("kWh")],
    [csvTextCell("Peak demand"), csvNumberCell(preview.summary.peakKw), csvTextCell("kW")],
    [csvTextCell("PUE estimate"), csvNumberCell(preview.summary.pueEstimate), csvTextCell("")],
    [
      csvTextCell("Indicative cost"),
      csvNumberCell(preview.summary.indicativeCostZar),
      csvTextCell("ZAR"),
    ],
    [
      csvTextCell("Tariff"),
      csvNumberCell(preview.summary.tariffZarPerKwh),
      csvTextCell("ZAR/kWh"),
    ],
    [],
    [csvTextCell("Source"), csvTextCell("Energy"), csvTextCell("Unit")],
    [csvTextCell("Grid"), csvNumberCell(preview.sourceTotals.gridKwh), csvTextCell("kWh")],
    [csvTextCell("Solar"), csvNumberCell(preview.sourceTotals.solarKwh), csvTextCell("kWh")],
    [csvTextCell("Nominal DG"), csvNumberCell(preview.sourceTotals.dgKwh), csvTextCell("kWh")],
    [],
    [
      csvTextCell("Asset code"),
      csvTextCell("Asset name"),
      csvTextCell("Site"),
      csvTextCell("Avg kW"),
      csvTextCell("Estimated kWh"),
    ],
    ...preview.topConsumers.map((consumer): CsvField[] => [
      // The three untrusted cells.
      csvTextCell(consumer.code),
      csvTextCell(consumer.name),
      csvTextCell(consumer.siteName),
      csvNumberCell(consumer.avgKw),
      csvNumberCell(consumer.estimatedKwh),
    ]),
  ];
  return csvDocument(rows);
}
