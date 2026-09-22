import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "../testing/repo-root";
import { describeBuffer, reportFilename } from "./report-file-store";

/**
 * `F3.5b` U7 — the pure helpers `report-file-store.ts` took out of
 * `ReportFilesService` (plan R-15). The moves themselves are gated by the
 * service specs staying green untouched; the rows here pin the two values
 * a caller relies on and the one rule ADR 0071 Amendment 1 item 12 states
 * about `reportFilename`'s signature — spelled once, here.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const STORE = join(repoRoot(), "apps/api/src/reports/report-file-store.ts");

/** SHA-256 of the ASCII bytes `abc` (FIPS 180-4 example B.1). */
const SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

export function assertPdfFilename(): void {
  const filename = reportFilename("2026-09-01", "2026-09-07", "pdf");
  assert(
    filename === "energy-consumption-2026-09-01-to-2026-09-07.pdf",
    `pdf filename was ${filename}`,
  );
}

export function assertXlsxFilename(): void {
  const filename = reportFilename("2026-09-01", "2026-09-07", "xlsx");
  assert(
    filename === "energy-consumption-2026-09-01-to-2026-09-07.xlsx",
    `xlsx filename was ${filename}`,
  );
}

export function assertDescribeBufferHashesAndMeasuresTheBytes(): void {
  const described = describeBuffer(Buffer.from("abc"));
  assert(
    described.sha256 === SHA256_OF_ABC && described.byteSize === 3,
    `describeBuffer(\"abc\") was ${JSON.stringify(described)}`,
  );
}

/** The parameter list between the parens of `function reportFilename(`, read from the source. */
function reportFilenameParameters(): string {
  const source = readFileSync(STORE, "utf8");
  const match = /function reportFilename\(([^)]*)\)/.exec(source);
  assert(match !== null, "report-file-store.ts declares no `function reportFilename(`");
  return match![1]!;
}

/** Positive control for the scan below: the three parameters the plan names, in order. */
export function assertReportFilenameTakesTwoDatesAndAFormat(): void {
  const names = reportFilenameParameters()
    .split(",")
    .map((parameter) => parameter.trim().split(":")[0]!.trim())
    .filter((parameter) => parameter.length > 0);
  assert(
    names.length === 3 && names[0] === "periodStart" && names[1] === "periodEnd" && names[2] === "format",
    `reportFilename parameters were [${names.join(", ")}]`,
  );
}

/**
 * ADR 0071 Amendment 1 item 12 — the filename is built from the period and
 * the format only; a schedule's name (or any title) never reaches it. The
 * scan is scoped to the parameter list, not the file, so prose stating this
 * rule cannot redden it.
 */
export function assertReportFilenameSignatureCarriesNoName(): void {
  const parameters = reportFilenameParameters();
  assert(
    !/\b(name|scheduleName|title)\b/.test(parameters),
    `reportFilename's parameter list names a title: (${parameters})`,
  );
}
