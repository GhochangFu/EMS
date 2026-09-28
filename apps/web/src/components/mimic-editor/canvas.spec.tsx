import { fireEvent, render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { editorReducer, fromPreset, initialEditorState, type EditorAction, type EditorState } from "../../lib/mimic-editor";
import { MimicEditorCanvas } from "./canvas";

/**
 * `F3.32c` U6b — the editor canvas in jsdom. jsdom has no layout, so the pixel drag is the
 * browser pass's (plan §8 B2); these hold the overlay's shape and what each pointer event
 * dispatches. `canvas.test.tsx` is the Vitest entry.
 */

function presetState(selected: string | null = null): EditorState {
  const s = initialEditorState(fromPreset("water_train"));
  return selected === null ? s : editorReducer(s, { type: "select", key: selected });
}

function renderCanvas(state: EditorState, pipeMode = false) {
  const dispatch = vi.fn<(action: EditorAction) => void>();
  const view = render(<MimicEditorCanvas state={state} dispatch={dispatch} pipeMode={pipeMode} />);
  return { dispatch, view };
}

function hit(key: string): Element {
  const found = screen.getAllByTestId("mimic-editor-hit").find((el) => el.getAttribute("data-node-key") === key);
  if (found === undefined) throw new Error(`no hit rect for ${key}`);
  return found;
}

/** C1 — one hit rect per node of the layout (3 panels + 9 units). */
export function drawsOneHitRectPerNode(): void {
  renderCanvas(presetState());
  expect(screen.getAllByTestId("mimic-editor-hit")).toHaveLength(12);
}

/** C2 — every hit rect is `fill="none"` (never a named colour, R14) and catches the pointer. */
export function hitRectsAreUnfilledAndCatchThePointer(): void {
  renderCanvas(presetState());
  const rects = screen.getAllByTestId("mimic-editor-hit");
  expect(rects.every((r) => r.getAttribute("fill") === "none" && r.getAttribute("pointer-events") === "all")).toBe(true);
}

/** C3 — a hit rect sits at its node's box × the 10-px cell. */
export function hitRectIsTheNodesBoxInViewBoxUnits(): void {
  renderCanvas(presetState());
  const wtp = hit("wtp");
  expect([wtp.getAttribute("x"), wtp.getAttribute("y"), wtp.getAttribute("width"), wtp.getAttribute("height")]).toEqual([
    "290",
    "40",
    "200",
    "250",
  ]);
}

/** C4 — a pointer down on a unit selects it. */
export function pointerDownSelectsTheNode(): void {
  const { dispatch } = renderCanvas(presetState());
  fireEvent.pointerDown(hit("ro"));
  expect(dispatch).toHaveBeenCalledWith({ type: "select", key: "ro" });
}

/** C5 — a click with no movement ends in a `set-box` at the origin (the reducer pushes nothing). */
export function aClickEndsInASetBoxAtTheOrigin(): void {
  const { dispatch } = renderCanvas(presetState());
  fireEvent.pointerDown(hit("ro"));
  fireEvent.pointerUp(hit("ro"));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "set-box", key: "ro", box: { x: 53, y: 4, w: 20, h: 25 } });
}

/** C6 — the selection outline is the accent stroke. */
export function theSelectionOutlineIsTheAccentStroke(): void {
  renderCanvas(presetState("stp"));
  expect(screen.getByTestId("mimic-editor-selection")).toHaveAttribute("class", "stroke-accent");
}

/** C7 — the selected node has a resize handle at its bottom-right corner. */
export function theSelectedNodeHasAResizeHandle(): void {
  renderCanvas(presetState("stp"));
  const handle = screen.getByTestId("mimic-editor-resize");
  // stp: x 77, y 41, w 20, h 25 → corner (970, 660), less the 14-unit handle.
  expect([handle.getAttribute("x"), handle.getAttribute("y")]).toEqual(["956", "646"]);
}

/** C8 — nothing selected, no resize handle. */
export function noSelectionNoHandle(): void {
  renderCanvas(presetState());
  expect(screen.queryByTestId("mimic-editor-resize")).toBeNull();
}

/** C9 — a pointer down on the background clears the selection. */
export function theBackgroundClearsTheSelection(): void {
  const { dispatch } = renderCanvas(presetState("stp"));
  fireEvent.pointerDown(screen.getByTestId("mimic-editor-background"));
  expect(dispatch).toHaveBeenCalledWith({ type: "select", key: null });
}

/** C10 — in pipe mode, two units clicked in turn add a pipe between them. */
export function pipeModeJoinsTwoClickedUnits(): void {
  const { dispatch } = renderCanvas(presetState(), true);
  fireEvent.pointerDown(hit("ro"));
  fireEvent.pointerDown(hit("etp"));
  expect(dispatch).toHaveBeenCalledWith({ type: "add-pipe", fromKey: "ro", toKey: "etp" });
}

/** C11 — in pipe mode, a panel is not a pipe end: clicking one dispatches nothing. */
export function pipeModeIgnoresAPanel(): void {
  const { dispatch } = renderCanvas(presetState(), true);
  fireEvent.pointerDown(hit("ro"));
  fireEvent.pointerDown(hit("treatment"));
  expect(dispatch).not.toHaveBeenCalled();
}

/** C12 — in pipe mode, the first unit clicked is outlined as the pipe's start. */
export function pipeModeOutlinesTheStart(): void {
  renderCanvas(presetState(), true);
  fireEvent.pointerDown(hit("wtp"));
  expect(screen.getByTestId("mimic-editor-pipe-start")).toHaveAttribute("x", "290");
}

/** C13 — the canvas draws the layout through `MimicScene`: a passive unit is `passive`. */
export function drawsThroughMimicScene(): void {
  const { view } = renderCanvas(presetState());
  const discharge = view.container.querySelector('[data-testid="mimic-node"][data-node-key="discharge"]');
  expect(discharge?.getAttribute("data-status")).toBe("passive");
}
