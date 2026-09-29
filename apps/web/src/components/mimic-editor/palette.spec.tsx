import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mimicCoreSymbolSchema } from "@bms/shared/contracts";
import { expect, vi } from "vitest";

import { MIMIC_SYMBOL_GROUPS, symbolLabel } from "../../lib/mimic-symbols";
import { MimicEditorPalette, type MimicEditorPaletteProps } from "./palette";

/**
 * `F3.32c` U6b, `F3.32d` U3 (ADR 0082 decision 2) — the editor palette, now grouped into eight
 * headings over 29 symbols. `palette.test.tsx` is the Vitest entry.
 */

function renderPalette(overrides: Partial<MimicEditorPaletteProps> = {}): MimicEditorPaletteProps {
  const props: MimicEditorPaletteProps = {
    onAddUnit: vi.fn(),
    onAddPanel: vi.fn(),
    onAddLabel: vi.fn(),
    pipeMode: false,
    onTogglePipeMode: vi.fn(),
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canDelete: true,
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<MimicEditorPalette {...props} />);
  return props;
}

/** P1 — one glyph button per symbol, in group order (General last), named by `symbolLabel`. */
export function offersTheTwentyNineSymbolsInGroupOrder(): void {
  renderPalette();
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  const expected = MIMIC_SYMBOL_GROUPS.flatMap((group) => group.symbols.map((s) => `Add ${symbolLabel(s)} unit`));
  expect(names).toEqual(expected);
  expect(names).toHaveLength(mimicCoreSymbolSchema.options.length);
}

/** P1b — eight group headings, in `MIMIC_SYMBOL_GROUPS` order, General last. */
export function offersEightGroupHeadingsInOrder(): void {
  renderPalette();
  const headings = screen.getAllByTestId("mimic-palette-group").map((section) => within(section).getByRole("heading").textContent);
  expect(headings).toEqual(MIMIC_SYMBOL_GROUPS.map((group) => group.label));
  expect(headings.at(-1)).toBe("General");
}

/** P1c — every symbol appears exactly once across the groups. */
export function everySymbolAppearsExactlyOnce(): void {
  renderPalette();
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
  expect(names.length).toBe(mimicCoreSymbolSchema.options.length);
}

/** P2 — each glyph button draws its glyph, in group order. */
export function eachSymbolButtonDrawsItsGlyphInGroupOrder(): void {
  renderPalette();
  const glyphs = screen.getAllByTestId("mimic-glyph").map((g) => g.getAttribute("data-glyph"));
  expect(glyphs).toEqual(MIMIC_SYMBOL_GROUPS.flatMap((group) => [...group.symbols]));
}

/** P2b — Transformer adds a unit of that symbol (ADR 0082 decision 1, the new Electrical group). */
export async function transformerAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add Transformer unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("transformer");
}

/** P2c — UPS adds a unit of that symbol (ADR 0082 decision 1, the new IT and UPS group). */
export async function upsAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add UPS unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("ups");
}

/** P3 — a glyph button adds a unit of that symbol. */
export async function aSymbolButtonAddsThatUnit(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Add Valve unit" }));
  expect(props.onAddUnit).toHaveBeenCalledWith("valve");
}

/** P4 — Panel adds a panel. */
export async function panelAddsAPanel(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Panel" }));
  expect(props.onAddPanel).toHaveBeenCalledTimes(1);
}

/** P5 — Label adds a label. */
export async function labelAddsALabel(): Promise<void> {
  const props = renderPalette();
  await userEvent.click(screen.getByRole("button", { name: "Label" }));
  expect(props.onAddLabel).toHaveBeenCalledTimes(1);
}

/** P6 — Undo is disabled with nothing to undo. */
export function undoIsDisabledWhenEmpty(): void {
  renderPalette({ canUndo: false });
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
}

/** P7 — Redo is disabled with nothing to redo. */
export function redoIsDisabledWhenEmpty(): void {
  renderPalette({ canRedo: false });
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
}

/** P8 — Undo is enabled with something to undo (the positive control for P6). */
export function undoIsEnabledWithHistory(): void {
  renderPalette({ canUndo: true });
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
}

/** P9 — Delete is disabled with nothing selected. */
export function deleteIsDisabledWithNoSelection(): void {
  renderPalette({ canDelete: false });
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
}

/** P10 — Pipe mode reports its state as `aria-pressed`. */
export function pipeModeIsAToggle(): void {
  renderPalette({ pipeMode: true });
  expect(screen.getByRole("button", { name: "Pipe mode" })).toHaveAttribute("aria-pressed", "true");
}
