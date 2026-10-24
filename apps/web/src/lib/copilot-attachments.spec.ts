import { MAX_IMPORT_FILE_BYTES } from "@bms/shared/contracts";
import { expect } from "vitest";

import { attachmentProblem } from "./copilot-attachments";

/**
 * `F4.283` (ADR 0099 Amendment 8 Q20) — the dock's picker takes a CSV or an
 * XLSX up to the import route's 5 MiB. The server re-checks from the bytes.
 * Vitest entry point: the sibling `.test.ts`.
 */

/** A `File` of the size the check reads, without allocating its bytes. */
function sized(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

export function aCsvOfFiveMebibytesIsAccepted(): void {
  expect(attachmentProblem(sized("readings.csv", MAX_IMPORT_FILE_BYTES))).toBeNull();
}

export function aCsvOverFiveMebibytesIsRefused(): void {
  expect(attachmentProblem(sized("readings.csv", MAX_IMPORT_FILE_BYTES + 1))).toBe('"readings.csv" is larger than 5 MB.');
}

export function anXlsxOverFiveMebibytesIsRefused(): void {
  expect(attachmentProblem(sized("readings.xlsx", MAX_IMPORT_FILE_BYTES + 1))).toBe('"readings.xlsx" is larger than 5 MB.');
}

/** The image cap is unchanged: a 6 MiB PNG is still accepted. */
export function aSixMebibytePngIsStillAccepted(): void {
  expect(attachmentProblem(sized("plant.png", 6 * 1024 * 1024))).toBeNull();
}
