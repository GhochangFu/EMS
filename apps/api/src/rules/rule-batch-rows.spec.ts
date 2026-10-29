import { expect } from "vitest";

import { applyExcludedRows, duplicateCodeRows } from "./rule-batch-rows";

/**
 * `F4.289` (ADR 0099 Amendment 9 E3) — the pure half of `POST /rules/batch`:
 * the rows the user left ticked, each beside its index in the sent body, and
 * the first two kept rows that carry the same explicit code. No database.
 */

const row = (name: string, code?: string): { name: string; code?: string } =>
  code === undefined ? { name } : { name, code };

/** An excluded index removes that row, and every kept row keeps its index in the sent body. */
export function excludedRowsRemoveRowsAndKeepTheOriginalIndex(): void {
  const kept = applyExcludedRows([row("A"), row("B"), row("C"), row("D")], [1, 2]);
  expect(kept.map(({ index, rule }) => [index, rule.name])).toEqual([
    [0, "A"],
    [3, "D"],
  ]);
}

/** An index past the last row removes nothing (the body's own bound is 24). */
export function anIndexPastTheEndIsIgnored(): void {
  const kept = applyExcludedRows([row("A"), row("B")], [5]);
  expect(kept.map(({ index }) => index)).toEqual([0, 1]);
}

/** Two kept rows with the same code (compared trimmed and upper-cased) are named by their indexes in the sent body. */
export function aDuplicateCodeNamesBothRows(): void {
  const kept = applyExcludedRows([row("A", "X-1"), row("B", "CHILLER"), row("C", "Y-1"), row("D", " chiller ")], [0]);
  expect(duplicateCodeRows(kept)).toEqual([1, 3]);
}

/** Rows without a code (or with a blank one) are never a duplicate: the service generates their codes. */
export function aBlankCodeIsNotADuplicate(): void {
  const kept = applyExcludedRows([row("A"), row("B"), row("C", "  "), row("D", "  ")]);
  expect(duplicateCodeRows(kept)).toBeNull();
}
