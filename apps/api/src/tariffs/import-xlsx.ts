import "../load-env";

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { upsertTariffCatalog } from "@bms/db";
import pg from "pg";

import { zipInflationProblem } from "../admin/spreadsheet-guard";
import { resolveDatabaseUrls } from "../database/database-urls";
import { parseRateChart, serialiseSnapshot } from "./rate-chart";
import { readRateChartRows } from "./rate-chart-read";

/**
 * `F4.365` (ADR 0134 decision 2, plan D2) — `pnpm --filter api tariffs:import <file> [--out <json>] [--apply]`.
 *
 * One parse, two sinks. With no flag it is a dry run that prints the
 * validation report. `--out` writes the committed snapshot
 * (`packages/db/src/tariff-catalog.json`). `--apply` upserts into the database
 * as `bms_fleet` (plan D3) inside one transaction. The workbook is untrusted
 * input: size and zip-inflation are bounded before it is read, formulas are
 * not evaluated, and only the Rate Chart sheet is touched.
 */
const MAX_BYTES = 5 * 1024 * 1024;

async function main(argv: string[]): Promise<number> {
  const file = argv.find((a) => !a.startsWith("--"));
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? argv[outIndex + 1] : undefined;
  const apply = argv.includes("--apply");
  if (!file || (outIndex >= 0 && !out)) {
    process.stderr.write("usage: tariffs:import <workbook.xlsx> [--out <snapshot.json>] [--apply]\n");
    return 2;
  }
  if (statSync(file).size > MAX_BYTES) {
    process.stderr.write(`the workbook is larger than ${MAX_BYTES} bytes\n`);
    return 1;
  }
  const buffer = readFileSync(file);
  const inflation = zipInflationProblem(buffer);
  if (inflation) {
    process.stderr.write(`${inflation}\n`);
    return 1;
  }
  const read = readRateChartRows(buffer);
  if (!read.ok) {
    process.stderr.write(`${read.problem}\n`);
    return 1;
  }
  const { rows } = read;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const result = parseRateChart(rows, { workbook: basename(file), sha256 });
  if (!result.ok) {
    process.stderr.write(`${result.problems.length} problem(s):\n${result.problems.slice(0, 50).join("\n")}\n`);
    return 1;
  }
  const { categories } = result.snapshot;
  const slabs = categories.reduce((n, c) => n + c.slabs.length, 0);
  process.stdout.write(`parsed ${categories.length} categories, ${slabs} slabs (sha256 ${sha256})\n`);

  if (out) {
    writeFileSync(out, serialiseSnapshot(result.snapshot));
    process.stdout.write(`wrote ${out}\n`);
  }
  if (apply) {
    const client = new pg.Client({ connectionString: resolveDatabaseUrls(process.env).fleet });
    await client.connect();
    try {
      await client.query("BEGIN");
      const written = await upsertTariffCatalog(client, result.snapshot);
      await client.query("COMMIT");
      process.stdout.write(`applied: ${written.categories} categories, ${written.slabs} slabs written\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`tariffs:import failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
