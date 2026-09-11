import { fireEvent, render, screen } from "@testing-library/react";
import { expect } from "vitest";

import { CALC_DIALECT, CALC_DIALECT_V2 } from "@bms/shared";

import { FormulaPreview } from "./formula-preview";

/**
 * `F2.22` T8 — the live formula preview panel (ADR 0038 decision 5), rendered
 * for the first time. `F2.5` shipped the pure half as `lib/calc-preview.ts` and
 * its spec; no panel ever called it (plan finding 1).
 *
 * Assertions live here; `formula-preview.test.tsx` is the Vitest entry point
 * (ADR 0014) and carries `@vitest-environment jsdom` because that is the file
 * Vitest collects (ADR 0042 decision 2).
 *
 * Every literal was read off `lib/calc-preview.spec.ts`'s probes of the real
 * `parseFormula` → `evaluate` pair, never recomputed here: `sum({kw} @site) /
 * {kw}` under `v2` yields one local ref (`kw`) and one aggregate at offset 0.
 *
 * **One `fireEvent.change` per input, never `userEvent.type`.** jsdom
 * sanitises a `type="number"` field's intermediate text, so a keystroke at a
 * time lands the wrong number (`F2.22` correction 23).
 *
 * The panel is queried by what a person sees: each sample input by its
 * accessible name, the result line by its `status` role — the implicit role
 * of `<output>`, which is the element a computed result belongs in.
 */

const MISSING_AGGREGATE =
  "no sample value for a referenced point or cross-asset reference at character 0";

const sampleFor = (label: string) =>
  screen.getByRole("spinbutton", { name: `Sample value for ${label}` }) as HTMLInputElement;
const sampleInputs = () => screen.queryAllByRole("spinbutton") as HTMLInputElement[];
const result = () => screen.queryByRole("status");

/**
 * Case 1 — one row per reference, and typing computes. Under `v2` the
 * aggregate is **one** input named by the node (`sum(kw) @site`), not a
 * member list (plan design decision 1); `kw` is the local row. `10 / 2`.
 *
 * This is the case the named mutation reddens: keying the cross map by
 * `node.pointKey` instead of `crossRefKey(node)` stores the aggregate's
 * sample under `kw`, which the evaluator never reads for an aggregate, and
 * the result line reads the `missing_input` refusal instead of `= 5`.
 */
export function aV2FormulaRendersARowPerReferenceAndComputes(): void {
  render(<FormulaPreview expression="sum({kw} @site) / {kw}" dialect={CALC_DIALECT_V2} />);

  fireEvent.change(sampleFor("sum(kw) @site"), { target: { value: "10" } });
  fireEvent.change(sampleFor("kw"), { target: { value: "2" } });

  expect(sampleInputs()).toHaveLength(2);
  expect(result()).toHaveTextContent("= 5");
}

/**
 * Case 2 — an empty aggregate row refuses at the aggregate's offset, with the
 * sentence that names both maps. This is the state the panel spends most of
 * its life in, and it must read as a prompt, not as a number.
 *
 * This is also the guard on `Number("")`, which is `0` and finite: a panel
 * that passed every row's text through `Number` would evaluate `0 / 2` here
 * and read `= 0`. An empty row must be **omitted**, so `evaluate` sees no
 * value for the node.
 */
export function anEmptyAggregateRowRefusesAtItsOffset(): void {
  render(<FormulaPreview expression="sum({kw} @site) / {kw}" dialect={CALC_DIALECT_V2} />);

  fireEvent.change(sampleFor("kw"), { target: { value: "2" } });

  expect(result()).toHaveTextContent(MISSING_AGGREGATE);
}

/**
 * Case 3 — a `v1` formula renders its local rows and no cross row, and
 * computes. Two spinbuttons exactly, so a cross row that leaked in under `v1`
 * would fail on the count before the names.
 */
export function aV1FormulaRendersLocalRowsOnly(): void {
  render(<FormulaPreview expression="{a} + {b}" dialect={CALC_DIALECT} />);

  expect(sampleInputs()).toHaveLength(2);
  fireEvent.change(sampleFor("a"), { target: { value: "3" } });
  fireEvent.change(sampleFor("b"), { target: { value: "4" } });

  expect(result()).toHaveTextContent("= 7");
}

/**
 * Case 4 — unparsable text renders no rows and no result line: the linter
 * owns the parse error (`calc-preview.ts`, `"unparsed"`). The same render is
 * first shown a parsable formula, so the absence below is measured against
 * a panel that was there a moment ago rather than one that never mounted.
 */
export function unparsableTextRendersNothing(): void {
  const { rerender } = render(<FormulaPreview expression="{a} + 1" dialect={CALC_DIALECT} />);
  expect(sampleInputs()).toHaveLength(1);
  expect(result()).not.toBeNull();

  rerender(<FormulaPreview expression="{a} +" dialect={CALC_DIALECT} />);

  expect(sampleInputs()).toHaveLength(0);
  expect(result()).toBeNull();
}

/**
 * Case 5 — `disabled` disables every sample input. On a frozen version the
 * tabs render the panel disabled rather than not at all, the rule
 * `asset-template-stock-view-page.spec.tsx`'s sweep states for every field:
 * disabled, not absent. The count is the positive control on the sweep.
 */
export function disabledDisablesEverySampleInput(): void {
  render(<FormulaPreview expression="sum({kw} @site) / {kw}" dialect={CALC_DIALECT_V2} disabled />);

  const inputs = sampleInputs();
  expect(inputs).toHaveLength(2);
  expect(inputs.filter((input) => !input.disabled).map((input) => input.outerHTML)).toEqual([]);
}

/**
 * Case 6 — the two other cross-reference label forms. `@bms/shared` has no
 * printer for a `CalcCrossRef`, so the panel builds the label from the node's
 * fields; case 1 covers `@site`, and this covers a scope with a code and a
 * qualified reference. Both must name the reference as the author wrote it.
 */
export function eachCrossReferenceFormIsLabelledAsWritten(): void {
  render(
    <FormulaPreview
      expression="sum({kw} @group('IT_LOAD')) + {TX_01.kwh}"
      dialect={CALC_DIALECT_V2}
    />,
  );

  expect(sampleFor("sum(kw) @group('IT_LOAD')")).toBeInTheDocument();
  expect(sampleFor("TX_01.kwh")).toBeInTheDocument();
  expect(sampleInputs()).toHaveLength(2);
}
