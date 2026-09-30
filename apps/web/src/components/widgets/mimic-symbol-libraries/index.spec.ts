import { MIMIC_SYMBOL_LIBRARIES, librarySymbolEntries, mimicShapeSchema, type MimicSymbolLibraryCode } from "@bms/shared";
import { expect } from "vitest";

import { librarySymbolShapes } from ".";

/**
 * `F3.32f` slice 2 (ADR 0086 decision 9, plan U5) — every vendored shape of every non-core
 * library parses under the shared contract grammar. `index.test.ts` is the Vitest entry.
 */

export const LIBRARY_CODES_UNDER_GRAMMAR: readonly MimicSymbolLibraryCode[] = MIMIC_SYMBOL_LIBRARIES.map((l) => l.code).filter(
  (code) => code !== "core",
);

/** The keys whose shapes are missing or fail `mimicShapeSchema`, one line each. */
function grammarFailures(code: MimicSymbolLibraryCode): { keys: number; failures: string[] } {
  const keys = librarySymbolEntries(code).map((entry) => entry.key);
  const failures: string[] = [];
  for (const key of keys) {
    const result = librarySymbolShapes(key);
    if (result === null) {
      failures.push(`${key}: no shapes`);
      continue;
    }
    result.shapes.forEach((shape, i) => {
      const parsed = mimicShapeSchema.safeParse(shape);
      if (!parsed.success) failures.push(`${key}[${i}]: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    });
  }
  return { keys: keys.length, failures };
}

/** G1 — every shape of library `code` parses; the three long-standing libraries hold keys (positive control). */
export function everyShapeParsesUnderTheContractGrammar(code: MimicSymbolLibraryCode): void {
  const { keys, failures } = grammarFailures(code);
  expect(failures, `${code} shapes outside the grammar`).toEqual([]);
  if (code === "tabler" || code === "lucide" || code === "mdi") {
    expect(keys, `${code} key count`).toBeGreaterThan(0);
  } else {
    // qet 137, wmpid 157 and drawio 131 at the slice-2 pins; each vendored library holds >= 100.
    expect(keys, `${code} key count (${keys})`).toBeGreaterThanOrEqual(100);
  }
}

/** G2 — a QElectroTech key draws in the stroke style; fails closed when `qet` has no keys. */
export function librarySymbolShapesReportsStrokeForQet(): void {
  const first = librarySymbolEntries("qet")[0];
  expect(first, "qet holds at least one key").toBeDefined();
  expect(librarySymbolShapes(first?.key ?? "")?.style).toBe("stroke");
}
