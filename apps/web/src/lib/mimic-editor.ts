import { MIMIC_LAYOUT_BOUNDS } from "@bms/shared/contracts";
import {
  MIMIC_PRESETS,
  MIMIC_SYMBOL_LIBRARIES,
  type MimicLayoutDto,
  type MimicLayoutNodeDto,
  type MimicLayoutPipeDto,
  type MimicPanelTone,
  type MimicPreset,
  type MimicPresetDef,
  type MimicSymbol,
  type MimicSymbolLibrarySelection,
  libraryOfSymbol,
} from "@bms/shared";

import type { MimicLayoutWriteBody, MimicLayoutWriteNode } from "../api/mimic-layouts";
import { MIMIC_LAYOUTS, MIMIC_NODE_GLYPHS, MIMIC_NODE_SIZE, MIMIC_PANELS } from "./mimic";
import { symbolLabel } from "./mimic-symbols";

/**
 * `F3.32c` U6 / ADR 0081 decision 7 — the mimic layout editor's state, as a pure reducer with
 * an in-memory history (plan D11).
 *
 * **History.** Every edit pushes the layout it replaced onto `past` and clears `future`. Two
 * actions never push: `select` (a selection is not an edit) and `preview` (a drag frame). A drag
 * is `preview` × n then one `set-box` on pointer-up; the first `preview` snapshots the layout into
 * `dragOrigin`, and `set-box` pushes THAT snapshot — so one undo returns the box from before the
 * drag, never the last frame. A `set-box` that ends where it began pushes nothing, so a plain
 * click on a node leaves Undo disabled.
 *
 * Every box is in grid cells (plan D4) and passes through `clampBox`, the one choke point for
 * the canvas bounds — the API's containment refine then has nothing to refuse.
 */

/** One node, in the read contract's shape: `symbol`, `roleCode` and `tone` are `null` when absent. */
export type EditorNode = MimicLayoutNodeDto;
export type EditorPipe = MimicLayoutPipeDto;

export type EditorLayout = {
  readonly name: string;
  readonly slug: string;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly nodes: readonly EditorNode[];
  readonly pipes: readonly EditorPipe[];
  /** The libraries the palette offers (ADR 0084 decision 8): never empty; `core` is not mandatory. */
  readonly symbolLibraries: readonly MimicSymbolLibrarySelection[];
};

export type EditorState = {
  readonly layout: EditorLayout;
  readonly selected: string | null;
  readonly past: readonly EditorLayout[];
  readonly future: readonly EditorLayout[];
  /** The layout as it stood before the current drag's first `preview`; `null` outside a drag. */
  readonly dragOrigin: EditorLayout | null;
};

export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type EditorNodePatch = {
  readonly label?: string;
  readonly symbol?: MimicSymbol;
  readonly roleCode?: string | null;
  readonly tone?: MimicPanelTone;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
};

export type EditorLayoutPatch = {
  readonly name?: string;
  readonly slug?: string;
  readonly canvasW?: number;
  readonly canvasH?: number;
  readonly symbolLibraries?: readonly MimicSymbolLibrarySelection[];
};

export type EditorAction =
  // `label` is the caller's (`F3.32f` slice 3): an organization symbol's label lives in the
  // catalog the page read, which this pure reducer does not hold; a static one is `symbolLabel`.
  | { readonly type: "add-unit"; readonly symbol: MimicSymbol; readonly label: string }
  | { readonly type: "add-panel" }
  | { readonly type: "add-label" }
  | { readonly type: "preview"; readonly key: string; readonly box: Box }
  | { readonly type: "set-box"; readonly key: string; readonly box: Box }
  | { readonly type: "select"; readonly key: string | null }
  | { readonly type: "update-node"; readonly key: string; readonly patch: EditorNodePatch }
  | { readonly type: "update-layout"; readonly patch: EditorLayoutPatch }
  | { readonly type: "delete"; readonly key?: string }
  | { readonly type: "add-pipe"; readonly fromKey: string; readonly toKey: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

/** The most layouts `past` keeps; the oldest drops first. */
export const MIMIC_EDITOR_HISTORY_LIMIT = 100;

/** Default sizes, in cells: a unit is the preset's 200 × 250 slot at 10 px per cell. */
export const MIMIC_EDITOR_DEFAULT_BOX = {
  unit: { w: MIMIC_NODE_SIZE.w / MIMIC_LAYOUT_BOUNDS.cell, h: MIMIC_NODE_SIZE.h / MIMIC_LAYOUT_BOUNDS.cell },
  panel: { w: 40, h: 30 },
  label: { w: 20, h: 3 },
} as const;

/** Drawing order: panels under units, units under labels (the API orders by `z, y, x`). */
export const MIMIC_EDITOR_Z = { panel: 0, unit: 10, label: 20 } as const;

/** Where a new node lands before the author moves it. */
const NEW_NODE_AT = { x: 2, y: 2 } as const;

/** A new, empty layout: the smallest name the API takes, a canvas the size of the preset's. */
export function emptyEditorLayout(): EditorLayout {
  return { name: "New plant", slug: "new-plant", canvasW: 126, canvasH: 68, nodes: [], pipes: [], symbolLibraries: ["core"] };
}

export function initialEditorState(layout: EditorLayout = emptyEditorLayout()): EditorState {
  return { layout, selected: null, past: [], future: [], dragOrigin: null };
}

/** A stored layout, as the editor holds it. */
export function layoutFromDto(dto: MimicLayoutDto): EditorLayout {
  return {
    name: dto.name,
    slug: dto.slug,
    canvasW: dto.canvasW,
    canvasH: dto.canvasH,
    nodes: dto.nodes,
    pipes: dto.pipes,
    symbolLibraries: dto.symbolLibraries,
  };
}

/**
 * A box held inside a `canvasW × canvasH` canvas: whole cells, at least 1 × 1, no larger than
 * the canvas (capped before the position is clamped, so a tall unit fits a short canvas), and
 * no edge past the canvas.
 */
export function clampBox(box: Box, canvasW: number, canvasH: number): Box {
  const w = Math.min(Math.max(1, Math.round(box.w)), canvasW);
  const h = Math.min(Math.max(1, Math.round(box.h)), canvasH);
  const x = Math.min(Math.max(0, Math.round(box.x)), canvasW - w);
  const y = Math.min(Math.max(0, Math.round(box.y)), canvasH - h);
  return { x, y, w, h };
}

/** The next free key for a prefix: one past the highest numeric suffix in use (`tank_3`). */
export function nextNodeKey(nodes: readonly EditorNode[], prefix: string): string {
  let max = 0;
  const pattern = new RegExp(`^${prefix}_(\\d+)$`);
  for (const node of nodes) {
    const match = pattern.exec(node.key);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${prefix}_${max + 1}`;
}

/**
 * The key prefix of a new unit of `symbol`: the symbol itself for a core key (`tank_1`), the
 * name after the colon with `-` → `_` for a library key (`mdi:heat-pump` → `heat_pump_1`) and
 * an organization key alike (`org.plant:inlet` → `inlet_1`) —
 * `MIMIC_LAYOUT_NODE_KEY` admits neither `:` nor `-`. Cut to 24 characters so the suffix fits
 * the 32-character key; a name that does not start with a letter falls back to `unit`.
 */
export function unitKeyPrefix(symbol: MimicSymbol): string {
  const name = symbol
    .slice(symbol.indexOf(":") + 1)
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 24)
    .replace(/_+$/, "");
  return /^[a-z]/.test(name) ? name : "unit";
}

/** A symbol's label — the table in `mimic-symbols.ts` (ADR 0082), re-exported for existing callers. */
export { symbolLabel };

function boxOf(node: EditorNode): Box {
  return { x: node.x, y: node.y, w: node.w, h: node.h };
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Replace the layout, pushing the one it replaced; `future` is cleared. */
function commit(state: EditorState, layout: EditorLayout, selected: string | null = state.selected): EditorState {
  const past = [...state.past, state.dragOrigin ?? state.layout].slice(-MIMIC_EDITOR_HISTORY_LIMIT);
  return { layout, selected, past, future: [], dragOrigin: null };
}

function withNode(layout: EditorLayout, key: string, next: (node: EditorNode) => EditorNode): EditorLayout {
  return { ...layout, nodes: layout.nodes.map((node) => (node.key === key ? next(node) : node)) };
}

function findNode(layout: EditorLayout, key: string): EditorNode | undefined {
  return layout.nodes.find((node) => node.key === key);
}

function addNode(state: EditorState, node: EditorNode): EditorState {
  if (state.layout.nodes.length >= MIMIC_LAYOUT_BOUNDS.maxNodes) {
    return state;
  }
  const { canvasW, canvasH } = state.layout;
  const placed = { ...node, ...clampBox(boxOf(node), canvasW, canvasH) };
  return commit(state, { ...state.layout, nodes: [...state.layout.nodes, placed] }, placed.key);
}

function newNode(
  state: EditorState,
  kind: EditorNode["kind"],
  prefix: string,
  fields: Pick<EditorNode, "symbol" | "label" | "tone">,
): EditorNode {
  return {
    key: nextNodeKey(state.layout.nodes, prefix),
    kind,
    roleCode: null,
    ...fields,
    ...NEW_NODE_AT,
    ...MIMIC_EDITOR_DEFAULT_BOX[kind],
    z: MIMIC_EDITOR_Z[kind],
  };
}

function inBounds(value: number, range: { readonly min: number; readonly max: number }): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max;
}

/**
 * The libraries the layout's units use, each with the unit keys that use it (ADR 0084
 * decision 9): a library in this map cannot be dropped, and the inspector disables its box.
 */
export function librariesInUse(layout: EditorLayout): ReadonlyMap<MimicSymbolLibrarySelection, readonly string[]> {
  const used = new Map<MimicSymbolLibrarySelection, string[]>();
  for (const node of layout.nodes) {
    if (node.kind === "unit" && node.symbol !== null) {
      const code = libraryOfSymbol(node.symbol);
      used.set(code, [...(used.get(code) ?? []), node.key]);
    }
  }
  return used;
}

/** A library list the layout may take: not empty, and keeping every library a unit uses. */
function librariesAllowed(layout: EditorLayout, next: readonly MimicSymbolLibrarySelection[]): boolean {
  if (next.length === 0) {
    return false;
  }
  return [...librariesInUse(layout).keys()].every((code) => next.includes(code));
}

function updateLayout(state: EditorState, patch: EditorLayoutPatch): EditorState {
  if (patch.symbolLibraries !== undefined && !librariesAllowed(state.layout, patch.symbolLibraries)) {
    return state;
  }
  const canvasW = patch.canvasW ?? state.layout.canvasW;
  const canvasH = patch.canvasH ?? state.layout.canvasH;
  if (!inBounds(canvasW, MIMIC_LAYOUT_BOUNDS.canvasW) || !inBounds(canvasH, MIMIC_LAYOUT_BOUNDS.canvasH)) {
    return state;
  }
  // A shrink that would leave a node outside the canvas is refused, not clamped: moving the
  // author's nodes silently is worse than keeping the size they had.
  if (state.layout.nodes.some((node) => node.x + node.w > canvasW || node.y + node.h > canvasH)) {
    return state;
  }
  return commit(state, { ...state.layout, ...patch, canvasW, canvasH });
}

function updateNode(state: EditorState, key: string, patch: EditorNodePatch): EditorState {
  const node = findNode(state.layout, key);
  if (node === undefined) {
    return state;
  }
  const { canvasW, canvasH } = state.layout;
  const box = clampBox({ ...boxOf(node), ...pickBox(patch) }, canvasW, canvasH);
  const next: EditorNode = {
    ...node,
    label: patch.label ?? node.label,
    symbol: node.kind === "unit" ? (patch.symbol ?? node.symbol) : null,
    roleCode: node.kind === "unit" && patch.roleCode !== undefined ? patch.roleCode : node.roleCode,
    tone: node.kind === "panel" ? (patch.tone ?? node.tone) : null,
    ...box,
  };
  return commit(state, withNode(state.layout, key, () => next));
}

function pickBox(patch: EditorNodePatch): Partial<Box> {
  const box: { x?: number; y?: number; w?: number; h?: number } = {};
  for (const axis of ["x", "y", "w", "h"] as const) {
    const value = patch[axis];
    if (value !== undefined && Number.isFinite(value)) {
      box[axis] = value;
    }
  }
  return box;
}

function deleteNode(state: EditorState, key: string | undefined): EditorState {
  const target = key ?? state.selected;
  if (target === null || findNode(state.layout, target) === undefined) {
    return state;
  }
  const layout: EditorLayout = {
    ...state.layout,
    nodes: state.layout.nodes.filter((node) => node.key !== target),
    pipes: state.layout.pipes.filter((pipe) => pipe.fromKey !== target && pipe.toKey !== target),
  };
  return commit(state, layout, state.selected === target ? null : state.selected);
}

/**
 * A pipe joins two different units (plan D7) and appears once per direction — the database's
 * unique key is ordered, so a reverse pipe is a second pipe. A refusal returns `state` itself.
 */
function addPipe(state: EditorState, fromKey: string, toKey: string): EditorState {
  if (fromKey === toKey || state.layout.pipes.length >= MIMIC_LAYOUT_BOUNDS.maxPipes) {
    return state;
  }
  const from = findNode(state.layout, fromKey);
  const to = findNode(state.layout, toKey);
  if (from?.kind !== "unit" || to?.kind !== "unit") {
    return state;
  }
  if (state.layout.pipes.some((pipe) => pipe.fromKey === fromKey && pipe.toKey === toKey)) {
    return state;
  }
  return commit(state, { ...state.layout, pipes: [...state.layout.pipes, { fromKey, toKey }] });
}

function keepSelection(layout: EditorLayout, selected: string | null): string | null {
  return selected !== null && findNode(layout, selected) !== undefined ? selected : null;
}

function undo(state: EditorState): EditorState {
  const previous = state.past.at(-1);
  if (previous === undefined) {
    return state;
  }
  const current = state.dragOrigin ?? state.layout;
  return {
    layout: previous,
    selected: keepSelection(previous, state.selected),
    past: state.past.slice(0, -1),
    future: [current, ...state.future],
    dragOrigin: null,
  };
}

function redo(state: EditorState): EditorState {
  const [next, ...rest] = state.future;
  if (next === undefined) {
    return state;
  }
  return {
    layout: next,
    selected: keepSelection(next, state.selected),
    past: [...state.past, state.dragOrigin ?? state.layout],
    future: rest,
    dragOrigin: null,
  };
}

function preview(state: EditorState, key: string, box: Box): EditorState {
  if (findNode(state.layout, key) === undefined) {
    return state;
  }
  const clamped = clampBox(box, state.layout.canvasW, state.layout.canvasH);
  return {
    ...state,
    layout: withNode(state.layout, key, (node) => ({ ...node, ...clamped })),
    dragOrigin: state.dragOrigin ?? state.layout,
  };
}

function setBox(state: EditorState, key: string, box: Box): EditorState {
  const origin = state.dragOrigin ?? state.layout;
  const before = findNode(origin, key);
  if (before === undefined) {
    return state;
  }
  const clamped = clampBox(box, origin.canvasW, origin.canvasH);
  if (sameBox(boxOf(before), clamped)) {
    return state.dragOrigin === null ? state : { ...state, layout: origin, dragOrigin: null };
  }
  return commit(state, withNode(origin, key, (node) => ({ ...node, ...clamped })));
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "add-unit":
      return addNode(
        state,
        newNode(state, "unit", unitKeyPrefix(action.symbol), { symbol: action.symbol, label: action.label, tone: null }),
      );
    case "add-panel":
      return addNode(state, newNode(state, "panel", "panel", { symbol: null, label: "Panel", tone: "info" }));
    case "add-label":
      return addNode(state, newNode(state, "label", "label", { symbol: null, label: "Label", tone: null }));
    case "preview":
      return preview(state, action.key, action.box);
    case "set-box":
      return setBox(state, action.key, action.box);
    case "select":
      return { ...state, selected: action.key === null ? null : keepSelection(state.layout, action.key) };
    case "update-node":
      return updateNode(state, action.key, action.patch);
    case "update-layout":
      return updateLayout(state, action.patch);
    case "delete":
      return deleteNode(state, action.key);
    case "add-pipe":
      return addPipe(state, action.fromKey, action.toKey);
    case "undo":
      return undo(state);
    case "redo":
      return redo(state);
  }
}

/**
 * The whole layout as `POST`/`PUT` take it. An absent field is OMITTED, never sent as `null`:
 * the API body is `.strict()` and types `symbol`, `roleCode` and `tone` optional, not nullable.
 */
export function toWriteBody(layout: EditorLayout): MimicLayoutWriteBody {
  return {
    name: layout.name,
    slug: layout.slug,
    canvasW: layout.canvasW,
    canvasH: layout.canvasH,
    nodes: layout.nodes.map((node) => {
      const out: MimicLayoutWriteNode = {
        key: node.key,
        kind: node.kind,
        label: node.label,
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        z: node.z,
      };
      if (node.symbol !== null) {
        out.symbol = node.symbol;
      }
      if (node.roleCode !== null) {
        out.roleCode = node.roleCode;
      }
      if (node.tone !== null) {
        out.tone = node.tone;
      }
      return out;
    }),
    pipes: layout.pipes.map((pipe) => ({ fromKey: pipe.fromKey, toKey: pipe.toKey })),
    symbolLibraries: [...layout.symbolLibraries],
  };
}

/** Pixels → cells, rounded (owner ruling OQ6: the copy is not pixel-identical to the preset). */
function toCell(px: number): number {
  return Math.round(px / MIMIC_LAYOUT_BOUNDS.cell);
}

/** A panel's frame round its members' boxes, in cells: 2 cells either side, a 3-cell title band. */
const PANEL_PAD = { side: 2, title: 3, bottom: 1 } as const;

function panelAround(members: readonly Box[]): Box {
  const x0 = Math.min(...members.map((b) => b.x));
  const x1 = Math.max(...members.map((b) => b.x + b.w));
  const y0 = Math.min(...members.map((b) => b.y));
  const y1 = Math.max(...members.map((b) => b.y + b.h));
  return {
    x: x0 - PANEL_PAD.side,
    y: y0 - PANEL_PAD.title,
    w: x1 - x0 + 2 * PANEL_PAD.side,
    h: y1 - y0 + PANEL_PAD.title + PANEL_PAD.bottom,
  };
}

/** `core`, then each library a unit draws from, in `MIMIC_SYMBOL_LIBRARIES` order. */
function presetLibraries(units: readonly EditorNode[]): MimicSymbolLibrarySelection[] {
  const used = new Set<MimicSymbolLibrarySelection>(["core"]);
  for (const unit of units) {
    if (unit.symbol !== null) {
      used.add(libraryOfSymbol(unit.symbol));
    }
  }
  return MIMIC_SYMBOL_LIBRARIES.map((library) => library.code).filter((code) => used.has(code));
}

/**
 * "Start from" a preset (ADR 0081 decision 4, generalised by ADR 0082 decision 5 to all seven
 * presets): the preset's roled units at the web's coordinates rounded to the grid, the panels
 * drawn round their members, and the preset's pipes.
 *
 * A preset with a sink (`water_train` alone) adds it as a passive unit (`roleCode: null`, plan
 * D6) one unit-pitch left of its upstream unit on that unit's row, inside that unit's panel, and
 * one more pipe into it. The sink is not placed at its preset tip (px 450): a unit-sized box
 * there overlaps ETP. A preset without a sink copies its nodes, panels and pipes only.
 *
 * The copy chooses `core` and every library its units draw from (`F3.32g`), in registry order —
 * a preset glyph is a library key since then, and the API refuses a unit whose library the
 * layout did not choose (ADR 0084 decision 8).
 */
export function fromPreset(preset: MimicPreset): EditorLayout {
  const def: MimicPresetDef = MIMIC_PRESETS[preset];
  const coords = MIMIC_LAYOUTS[preset];
  const nodesAt = coords.nodes as Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  const glyphs = MIMIC_NODE_GLYPHS[preset] as Readonly<Record<string, MimicSymbol>>;
  const size = MIMIC_EDITOR_DEFAULT_BOX.unit;
  const [, , viewW, viewH] = coords.viewBox.split(" ").map(Number);

  const units: EditorNode[] = def.nodes.map((node) => {
    const at = nodesAt[node.key];
    const symbol = glyphs[node.key];
    // The web tables are mapped over the preset's node keys, so this cannot happen short of a
    // cast gap — and a starter at (0, 0) drawn as a box would hide one.
    if (at === undefined || symbol === undefined) {
      throw new Error(`preset ${preset}: node ${node.key} has no web position or glyph`);
    }
    return {
      key: node.key,
      kind: "unit",
      symbol,
      label: node.label,
      roleCode: node.roleCode,
      tone: null,
      x: toCell(at.x),
      y: toCell(at.y),
      ...size,
      z: MIMIC_EDITOR_Z.unit,
    };
  });

  const sinkDef = def.sink;
  const upstream = sinkDef === undefined ? undefined : units.find((unit) => unit.key === sinkDef.from);
  const sinkKey = "discharge";
  if (upstream !== undefined && sinkDef !== undefined) {
    units.push({
      key: sinkKey,
      kind: "unit",
      symbol: "discharge",
      label: sinkDef.label,
      roleCode: null,
      tone: null,
      x: upstream.x - (size.w + 4),
      y: upstream.y,
      ...size,
      z: MIMIC_EDITOR_Z.unit,
    });
  }

  const panels: EditorNode[] = MIMIC_PANELS[preset].map((panel) => {
    const memberKeys = new Set<string>(panel.nodes);
    if (upstream !== undefined && memberKeys.has(upstream.key)) {
      memberKeys.add(sinkKey);
    }
    const members = units.filter((unit) => memberKeys.has(unit.key));
    return {
      key: panel.key,
      kind: "panel",
      symbol: null,
      label: panel.label,
      roleCode: null,
      tone: panel.tone,
      ...panelAround(members),
      z: MIMIC_EDITOR_Z.panel,
    };
  });

  const pipes: EditorPipe[] = def.pipes.map((pipe) => ({ fromKey: pipe.from, toKey: pipe.to }));
  if (upstream !== undefined) {
    pipes.push({ fromKey: upstream.key, toKey: sinkKey });
  }

  return {
    name: def.label,
    slug: preset.replace(/_/g, "-"),
    canvasW: toCell(viewW ?? 0),
    canvasH: toCell(viewH ?? 0),
    nodes: [...panels, ...units],
    pipes,
    symbolLibraries: presetLibraries(units),
  };
}

/** The structural slice of a `KeyboardEvent` `keyboardAction` reads — no DOM needed in a spec. */
export type EditorKeyEvent = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey?: boolean;
  readonly target: { readonly tagName?: string; readonly isContentEditable?: boolean } | null;
};

const TEXT_ENTRY_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

const ARROWS: Readonly<Record<string, { readonly dx: number; readonly dy: number }>> = {
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
};

/**
 * A key → the editor action it means (ADR 0081 decision 7): an arrow moves the selected node one
 * cell, Shift + arrow resizes it one cell, Delete (or Backspace) removes it, Ctrl+Z undoes,
 * Ctrl+Y and Ctrl+Shift+Z redo. `null` for any other key, for an arrow with nothing selected,
 * and for every key typed into an input, select or textarea — the inspector's fields keep their
 * own keys.
 */
export function keyboardAction(event: EditorKeyEvent, state: EditorState): EditorAction | null {
  const target = event.target;
  if (target !== null && (TEXT_ENTRY_TAGS.has((target.tagName ?? "").toUpperCase()) || target.isContentEditable === true)) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey === true) {
    if (key === "z") {
      return event.shiftKey ? { type: "redo" } : { type: "undo" };
    }
    return key === "y" ? { type: "redo" } : null;
  }
  const selected = state.selected === null ? undefined : findNode(state.layout, state.selected);
  if (selected === undefined) {
    return null;
  }
  if (key === "delete" || key === "backspace") {
    return { type: "delete", key: selected.key };
  }
  const arrow = ARROWS[key];
  if (arrow === undefined) {
    return null;
  }
  const box = event.shiftKey
    ? { x: selected.x, y: selected.y, w: selected.w + arrow.dx, h: selected.h + arrow.dy }
    : { x: selected.x + arrow.dx, y: selected.y + arrow.dy, w: selected.w, h: selected.h };
  return { type: "set-box", key: selected.key, box };
}
