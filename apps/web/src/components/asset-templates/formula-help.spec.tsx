import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { CALC_DIALECT, CALC_DIALECT_V3, CALC_FUNCTION_ARITY } from "@bms/shared";

import { FormulaHelp } from "./formula-help";

/**
 * `F4.314` PR 1 (ADR 0038 Amendment 6 decisions A1, A4, A6) — the Formula
 * help section. Assertions live here; `formula-help.test.tsx` is the Vitest
 * entry point (ADR 0014) and carries `@vitest-environment jsdom` (ADR 0042
 * decision 2). Each helper names the mutation that reddens it.
 */

/** The accessible names of the buttons in one group's list. */
function buttonsIn(group: string): string[] {
  return within(screen.getByRole("list", { name: group }))
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

/**
 * Under `v1` the Functions list is exactly the five `CALC_FUNCTION_ARITY`
 * names.
 *
 * Mutation: render the `v3` list whatever the dialect.
 */
export function v1ListsExactlyTheFiveFunctions(): void {
  render(<FormulaHelp dialect={CALC_DIALECT} disabled={false} onInsert={() => undefined} />);
  expect(buttonsIn("Functions")).toEqual(Object.keys(CALC_FUNCTION_ARITY).map((name) => `Insert ${name}`));
}

/**
 * Under `v1` there is no Scopes list — no `@` entry is offered on a field
 * whose grammar has none.
 *
 * Mutation: render the `v3` list whatever the dialect.
 */
export function v1ListsNoScope(): void {
  render(<FormulaHelp dialect={CALC_DIALECT} disabled={false} onInsert={() => undefined} />);
  expect(screen.queryByRole("list", { name: "Scopes" })).toBeNull();
}

/**
 * Under `v3` the window forms appear, `delta` and `hours` among them.
 *
 * Mutation: render the `v1` list whatever the dialect.
 */
export function v3ListsTheWindowForms(): void {
  render(<FormulaHelp dialect={CALC_DIALECT_V3} disabled={false} onInsert={() => undefined} />);
  expect(buttonsIn("Windows")).toEqual(expect.arrayContaining(["Insert delta over a window", "Insert hours of a window"]));
}

/**
 * Clicking an entry hands its insert text to `onInsert` — the name and its
 * opening parenthesis for a function.
 *
 * Mutation: pass the label instead of the insert.
 */
export async function clickingAnEntryInsertsItsText(): Promise<void> {
  const onInsert = vi.fn();
  render(<FormulaHelp dialect={CALC_DIALECT} disabled={false} onInsert={onInsert} />);
  await userEvent.click(screen.getByRole("button", { name: "Insert round" }));
  expect(onInsert.mock.calls).toEqual([["round("]]);
}

/**
 * `disabled` disables every entry — a published or archived version's help
 * is read-only (ADR 0038 decision 3, Amendment 6 A6).
 *
 * Mutation: drop `disabled` from the buttons.
 */
export function disabledDisablesEveryEntry(): void {
  render(<FormulaHelp dialect={CALC_DIALECT_V3} disabled onInsert={() => undefined} />);
  const enabled = screen.getAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled);
  expect(enabled.map((button) => button.getAttribute("aria-label"))).toEqual([]);
}

/**
 * The section starts collapsed (ruling 4).
 *
 * Mutation: render `<details open>`.
 */
export function theSectionStartsCollapsed(): void {
  const { container } = render(<FormulaHelp dialect={CALC_DIALECT} disabled={false} onInsert={() => undefined} />);
  const details = container.querySelector("details");
  expect([details?.querySelector("summary")?.textContent, details?.open]).toEqual(["Formula help", false]);
}
