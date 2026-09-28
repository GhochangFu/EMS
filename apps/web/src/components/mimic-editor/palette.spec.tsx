import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mimicSymbolSchema } from "@bms/shared/contracts";
import { expect, vi } from "vitest";

import { MimicEditorPalette, type MimicEditorPaletteProps } from "./palette";

/** `F3.32c` U6b — the editor palette. `palette.test.tsx` is the Vitest entry. */

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

/** P1 — one glyph button per symbol, in the contract's order. */
export function offersTheTwelveSymbolsInOrder(): void {
  renderPalette();
  const names = screen.getAllByRole("button", { name: /^Add .* unit$/ }).map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(mimicSymbolSchema.options.map((s) => `Add ${s.charAt(0).toUpperCase()}${s.slice(1)} unit`));
}

/** P2 — each glyph button draws its glyph. */
export function eachSymbolButtonDrawsItsGlyph(): void {
  renderPalette();
  const glyphs = screen.getAllByTestId("mimic-glyph").map((g) => g.getAttribute("data-glyph"));
  expect(glyphs).toEqual([...mimicSymbolSchema.options]);
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
