import { fireEvent, render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { METRIC_CATALOG } from "@bms/shared";

import { TableColumnPicker } from "./table-column-picker";

/**
 * `F3.35` Stage B — the column picker (ADR 0048 decision 2).
 *
 * Assertions live here; `table-column-picker.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * **What this file is for: the picker must not be able to produce a payload the API refuses.**
 * `eachTableColumnIsDeclared` answers 400 for a column the bound dataset does not declare, and
 * both sides read `METRIC_CATALOG` — so the options offered here are asserted against that
 * record rather than against a literal list, which is what keeps the two from drifting.
 */

const DATASET_KEY = "alarms.active" as const;

const declaredColumns = (): readonly string[] => {
  const entry = METRIC_CATALOG[DATASET_KEY];
  if (entry.shape !== "dataset") {
    throw new Error(`${DATASET_KEY} must be a dataset — every assertion here assumes it`);
  }
  return entry.columns;
};

/** Every declared column is offered, and nothing else is. */
export function offersExactlyTheDeclaredColumns(): void {
  render(<TableColumnPicker catalogKey={DATASET_KEY} chosen={[]} onChange={() => {}} />);

  const declared = declaredColumns();
  expect(declared.length, "the fixture is pointless if the dataset declares nothing").toBeGreaterThan(1);

  for (const column of declared) {
    expect(
      screen.getByRole("checkbox", { name: column }),
      `"${column}" is declared by ${DATASET_KEY} and must be offered`,
    ).toBeDefined();
  }
  expect(screen.getAllByRole("checkbox").length).toBe(declared.length);
}

/**
 * Nothing chosen reads as "showing every column", never as "showing none".
 *
 * The empty state is the one a table is CREATED in — `tableConfigSchema` reads absent and empty
 * alike as every declared column — so a picker whose empty state looked like a broken card
 * would push every author into ticking all six by hand for no effect.
 */
export function theEmptyStateSaysEveryColumn(): void {
  render(<TableColumnPicker catalogKey={DATASET_KEY} chosen={[]} onChange={() => {}} />);
  expect(screen.getByText(/Showing every column/i)).toBeDefined();
}

/** Ticking a box APPENDS, so the chosen order is the order the author ticked. */
export function tickingAppendsInTheAuthorsOrder(): void {
  const declared = declaredColumns();
  const first = declared[0] as string;
  const third = declared[2] as string;

  const calls: string[][] = [];
  // Already holding the THIRD column, so appending the first proves order is not re-sorted
  // into the declared order — a `.sort()` in the picker would give `[first, third]` here and
  // would look perfectly reasonable in a diff.
  render(
    <TableColumnPicker
      catalogKey={DATASET_KEY}
      chosen={[third]}
      onChange={(columns) => calls.push(columns)}
    />,
  );

  fireEvent.click(screen.getByRole("checkbox", { name: first }));
  expect(calls).toEqual([[third, first]]);
}

/** Un-ticking removes only that column and leaves the rest in their order. */
export function untickingRemovesOnlyThatColumn(): void {
  const declared = declaredColumns();
  const [a, b, c] = declared as [string, string, string];

  const calls: string[][] = [];
  render(
    <TableColumnPicker
      catalogKey={DATASET_KEY}
      chosen={[c, a, b]}
      onChange={(columns) => calls.push(columns)}
    />,
  );

  fireEvent.click(screen.getByRole("checkbox", { name: a }));
  expect(calls).toEqual([[c, b]]);
}

/**
 * The arrows reorder, and without them the picker could say *which* columns but never
 * *which first* — which on a six-column dataset in a three-column card is most of the decision.
 */
export function theArrowsReorderTheProjection(): void {
  const declared = declaredColumns();
  const [a, b] = declared as [string, string];

  const calls: string[][] = [];
  render(
    <TableColumnPicker
      catalogKey={DATASET_KEY}
      chosen={[a, b]}
      onChange={(columns) => calls.push(columns)}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: `Move ${b} earlier` }));
  expect(calls).toEqual([[b, a]]);

  // The ends are disabled rather than silently no-op, so an author is not left clicking a
  // control that does nothing and wondering whether the form is broken.
  expect(
    screen.getByRole("button", { name: `Move ${a} earlier` }).hasAttribute("disabled"),
    "the first column cannot move earlier",
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: `Move ${b} later` }).hasAttribute("disabled"),
    "the last column cannot move later",
  ).toBe(true);
}

/**
 * A METRIC binding renders nothing rather than throwing.
 *
 * Unreachable through the builder — `WIDGET_SOURCE_SHAPES.table` is `["dataset"]` — but a
 * dashboard stored before that rule existed must still OPEN in the inspector, because opening
 * it is how an author would repair it. A throw here would break the page they repair it on.
 */
export function aMetricBindingRendersNothing(): void {
  const { container } = render(
    <TableColumnPicker catalogKey="alarms.active.count" chosen={[]} onChange={() => {}} />,
  );
  expect(container.textContent).toBe("");
}
