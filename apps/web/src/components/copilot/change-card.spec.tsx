import { render } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { ChangeRow } from "../../lib/copilot-diff";
import { ChangeCard } from "./change-card";

/**
 * `F4.246` (ADR 0099 §3, owner ruling 2026-10-20 option C, "Summary + expand") — a shortened
 * value cell opens to the full value; a value shown whole has no control. Vitest entry point:
 * `change-card.test.tsx` (jsdom).
 */

const SHORT = `{"kpis":[{"code":"k0"…`;
const FULL = JSON.stringify({ kpis: [{ code: "k0", expression: "kw * 2" }] }, null, 2);
const NOW_SHORT = `{"kpis":[{"code":"n0"…`;
const NOW_FULL = JSON.stringify({ kpis: [{ code: "n0", expression: "kw * 3" }] }, null, 2);

function renderCard(rows: readonly ChangeRow[]): HTMLElement {
  const { container } = render(
    <ChangeCard title="Edit an asset template" summary="Edit." risk="edit" rows={rows} busy={false} confirmLabel="Confirm" busyLabel="…" onConfirm={() => {}} />,
  );
  return container;
}

/** The first row's value cell at `column`: 0 is Now when any row has one, else the value itself. */
function cellOf(container: HTMLElement, column: number): HTMLTableCellElement {
  const cell = container.querySelectorAll("tbody tr")[0]?.querySelectorAll("td")[column];
  if (!cell) throw new Error(`no cell ${column}`);
  return cell;
}

/** A row with `afterFull` renders the summary as the `<summary>` and the full value in the `<pre>`. */
export function aShortenedRowExpandsToItsFullText(): void {
  const container = renderCard([{ field: "content", after: SHORT, afterFull: FULL, changed: true }]);
  const cell = cellOf(container, 0);
  expect(cell.querySelector("details > summary")?.textContent).toBe(SHORT);
  expect(cell.querySelector("details > pre")?.textContent).toBe(FULL);
}

/** The Now cell expands to its own full value, not the proposed one. */
export function aShortenedNowValueExpandsToItsOwnFullText(): void {
  const container = renderCard([
    { field: "content", before: NOW_SHORT, beforeFull: NOW_FULL, after: SHORT, afterFull: FULL, changed: true },
  ]);
  const now = cellOf(container, 0);
  expect(now.querySelector("details > summary")?.textContent).toBe(NOW_SHORT);
  expect(now.querySelector("details > pre")?.textContent).toBe(NOW_FULL);
}

/** A row without full text is plain text — and the positive twin proves the cell was found and filled. */
export function aPlainRowHasNoExpandControl(): void {
  const container = renderCard([{ field: "name", after: "Feeder", changed: true }]);
  const cell = cellOf(container, 0);
  expect(cell.textContent).toBe("Feeder");
  expect(cell.querySelector("details")).toBeNull();
}

/**
 * Two rows on one field (a field row and a row with its own label) are two keyed rows: React
 * reports no duplicate key, and both render.
 */
export function rowsOnOneFieldAreKeyedApart(): void {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const container = renderCard([
      { field: "formula", after: "{KW} * 3", changed: true },
      { field: "formula", label: "Formula eff", after: "{KW} * 3 (inherited dialect)", changed: true },
    ]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  } finally {
    error.mockRestore();
  }
}
