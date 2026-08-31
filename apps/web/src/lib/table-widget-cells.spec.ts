import { expect } from "vitest";

import { projectColumns, tableCellText } from "./table-widget-cells";

/**
 * `F3.35` Stage B — the pure half of the table renderer (ADR 0014: assertions here, the Vitest
 * wrapper in the sibling `.test.ts`).
 *
 * Both functions decide something an operator reads. `projectColumns` decides which columns a
 * card shows and in what order; `tableCellText` decides what absence looks like. Neither is
 * reachable from a type error, so both are tested directly rather than through the component.
 */

export function runProjectColumnsTests(): void {
  const declared = ["assetCode", "assetName", "severity", "message", "raisedAt"];

  // Absent and empty are ONE state — `tableConfigSchema` rules that both mean "every declared
  // column", and `buildTableConfig` writes only the absent form. If these two ever disagreed,
  // a table would render differently depending on which of two equivalent configs was stored.
  expect(projectColumns(declared, undefined)).toEqual(declared);
  expect(projectColumns(declared, [])).toEqual(declared);

  // The author's ORDER survives, and this is the whole column picker. A `.sort()` anywhere in
  // this path would silently discard the one thing the picker produces, and the card would
  // still look plausible — which is why the assertion uses a deliberately non-alphabetical
  // choice rather than a subset that happens to already be in order.
  expect(projectColumns(declared, ["severity", "assetCode"])).toEqual(["severity", "assetCode"]);

  // A name the dataset does not declare is DROPPED, not rendered as an empty column. This is
  // the state a released catalog change leaves behind in a stored config, and the write-path
  // rule in `dashboards.schema.ts` cannot reach a config that was already saved.
  expect(projectColumns(declared, ["assetCode", "notAColumn", "severity"])).toEqual([
    "assetCode",
    "severity",
  ]);

  // Every chosen column undeclared collapses to nothing — NOT to "every declared column".
  // Falling back to the full list here would be the plausible-looking bug: an author whose
  // config went stale would see a card silently widen instead of being told to fix it.
  expect(projectColumns(declared, ["gone", "alsoGone"])).toEqual([]);

  // A dataset that declares nothing yields nothing, whatever was chosen.
  expect(projectColumns([], ["assetCode"])).toEqual([]);
}

export function runTableCellTextTests(): void {
  // `null` is an em dash, never the string "null" and never blank. Blank reads as "does not
  // apply"; "null" reads as a bug. `undefined` is the same state reached a different way — a
  // row that simply has no key for a declared column.
  expect(tableCellText(null)).toBe("—");
  expect(tableCellText(undefined)).toBe("—");

  // `false` must be visible. `String(false)` is "false", but the trap this guards is the
  // shorter-looking `cell || "—"`, which renders an em dash for `false`, for `0` and for the
  // empty string — three real values reported as absent.
  expect(tableCellText(false)).toBe("No");
  expect(tableCellText(true)).toBe("Yes");
  expect(tableCellText(0)).toBe("0");
  expect(tableCellText("")).toBe("");

  expect(tableCellText("critical")).toBe("critical");
  expect(tableCellText(12.5)).toBe("12.5");
}
