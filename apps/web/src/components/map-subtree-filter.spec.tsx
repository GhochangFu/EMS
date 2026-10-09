import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import type { AccessLocation } from "@bms/shared";

import { MapSubtreeFilter } from "./map-subtree-filter";

/**
 * `F2.10` (ADR 0098 decision 11, B12, B13) — the map's parent filter on its own. Assertions live
 * here; `map-subtree-filter.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock.
 */

function node(id: string, name: string, parentId: string | null): AccessLocation {
  return { id, code: id.toUpperCase(), slug: id, name, type: "site", province: null, parentId };
}

/** Out of name order on purpose: the asset-group scope has no ORDER BY. Region > Campus > Site. */
const TREE = [
  node("x1", "Site X1", "x"),
  node("y", "Yard", null),
  node("x", "Campus X", "r"),
  node("r", "Region", null),
];

/** Z1 — only interior nodes, in tree order, with the tree's dashes. */
export function offersOnlyInteriorNodesInTreeOrder(): void {
  render(<MapSubtreeFilter nodes={TREE} value={null} onChange={vi.fn()} />);
  const select = screen.getByLabelText("Zoom to");
  const labels = within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);
  expect(labels).toEqual(["All sites", "Region", "— Campus X"]);
}

/** Z2 — with no interior node there is no filter at all (B13). */
export function rendersNothingForAFlatScope(): void {
  const { container } = render(
    <MapSubtreeFilter nodes={[node("a", "A", null), node("b", "B", null)]} value={null} onChange={vi.fn()} />,
  );
  expect(container.innerHTML).toBe("");
}

/** Z3 — choosing a node reports its id; "All sites" reports null. */
export async function reportsTheChoice(): Promise<void> {
  const onChange = vi.fn();
  const { rerender } = render(<MapSubtreeFilter nodes={TREE} value={null} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Zoom to"), "x");
  expect(onChange).toHaveBeenLastCalledWith("x");
  rerender(<MapSubtreeFilter nodes={TREE} value="x" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("Zoom to"), "");
  expect(onChange).toHaveBeenLastCalledWith(null);
}
