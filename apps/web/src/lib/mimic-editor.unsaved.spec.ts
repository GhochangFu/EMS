import type { MimicLayoutDto } from "@bms/shared";
import { expect } from "vitest";

import {
  editorReducer,
  fromPreset,
  hasUnsavedEdits,
  initialEditorState,
  layoutFromDto,
  type EditorState,
} from "./mimic-editor";

/**
 * `F4.308` T6 (ADR 0081 Amendment 2 decision 4, plan C11) — `hasUnsavedEdits`: whether the
 * editor's layout differs from the last save, as the write body reads them. An undo back to the
 * saved layout is no edit. `mimic-editor.unsaved.test.ts` is the Vitest entry.
 */

function savedDto(): MimicLayoutDto {
  const layout = fromPreset("water_train");
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    name: "Stored plant",
    slug: "stored-plant",
    canvasW: layout.canvasW,
    canvasH: layout.canvasH,
    version: 3,
    symbolLibraries: ["core"],
    nodes: [...layout.nodes],
    pipes: [...layout.pipes],
    orgSymbols: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function loaded(dto: MimicLayoutDto): EditorState {
  return initialEditorState(layoutFromDto(dto));
}

/** U1 — the layout as loaded is not an edit. */
export function aLoadedLayoutHasNoUnsavedEdits(): void {
  const dto = savedDto();
  expect(hasUnsavedEdits(loaded(dto).layout, dto)).toBe(false);
}

/** U2 — a moved unit is an edit. */
export function aMoveIsAnUnsavedEdit(): void {
  const dto = savedDto();
  const moved = editorReducer(loaded(dto), { type: "set-box", key: "wtp", box: { x: 30, y: 4, w: 20, h: 25 } });
  expect(hasUnsavedEdits(moved.layout, dto)).toBe(true);
}

/** U3 — an undo back to the saved layout is no edit. */
export function anUndoBackToTheSaveIsNoEdit(): void {
  const dto = savedDto();
  const moved = editorReducer(loaded(dto), { type: "set-box", key: "wtp", box: { x: 30, y: 4, w: 20, h: 25 } });
  const undone = editorReducer(moved, { type: "undo" });
  expect(undone.layout).not.toBe(loaded(dto).layout);
  expect(hasUnsavedEdits(undone.layout, dto)).toBe(false);
}

/** U4 — a roled unit's point list changed is an edit (F4.307's list is in the write body). */
export function aPointListChangeIsAnUnsavedEdit(): void {
  const dto = savedDto();
  const listed = editorReducer(loaded(dto), { type: "update-node", key: "wtp", patch: { pointKeys: ["level"] } });
  expect(hasUnsavedEdits(listed.layout, dto)).toBe(true);
}

/** U5 — a renamed layout is an edit. */
export function aRenameIsAnUnsavedEdit(): void {
  const dto = savedDto();
  const renamed = editorReducer(loaded(dto), { type: "update-layout", patch: { name: "Renamed plant" } });
  expect(hasUnsavedEdits(renamed.layout, dto)).toBe(true);
}

/**
 * U6 (review H1) — the server answers nodes by (z, y, x, key) and pipes by (fromKey, toKey): the
 * same layout in another order is no edit.
 */
export function aReorderedButEqualLayoutIsNoEdit(): void {
  const dto = savedDto();
  const reordered: MimicLayoutDto = { ...dto, nodes: [...dto.nodes].reverse(), pipes: [...dto.pipes].reverse() };
  expect(hasUnsavedEdits(loaded(dto).layout, reordered)).toBe(false);
  expect(hasUnsavedEdits(loaded(reordered).layout, dto)).toBe(false);
}

/** U7 (review H1) — the contract trims `name` and `label`: an untrimmed copy is no edit. */
export function anUntrimmedNameOrLabelIsNoEdit(): void {
  const dto = savedDto();
  const padded = editorReducer(
    editorReducer(loaded(dto), { type: "update-layout", patch: { name: "  Stored plant " } }),
    { type: "update-node", key: "wtp", patch: { label: "WTP " } },
  );
  expect(hasUnsavedEdits(padded.layout, dto)).toBe(false);
}

/** U8 — a unit's point list is compared in order: the order is the drawing's. */
export function aReorderedPointListIsAnEdit(): void {
  const dto = savedDto();
  const listed = { ...dto, nodes: dto.nodes.map((n) => (n.key === "wtp" ? { ...n, pointKeys: ["flow", "level"] } : n)) };
  const swapped = editorReducer(loaded(listed), { type: "update-node", key: "wtp", patch: { pointKeys: ["level", "flow"] } });
  expect(hasUnsavedEdits(swapped.layout, listed)).toBe(true);
}
