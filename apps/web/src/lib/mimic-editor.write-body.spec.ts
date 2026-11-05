import type { MimicLayoutDto } from "@bms/shared";
import { MIMIC_HEADLINE_POINTS, putMimicLayoutBodySchema } from "@bms/shared/contracts";
import { expect } from "vitest";

import type { MimicLayoutWriteBody, MimicLayoutWriteNode } from "../api/mimic-layouts";
import {
  editorLayoutFromWriteBody,
  editorReducer,
  fromPreset,
  initialEditorState,
  layoutFromDto,
  toWriteBody,
  type EditorLayout,
  type EditorNodePatch,
} from "./mimic-editor";

/**
 * `F3.87` PR 5 — the write body ↔ editor layout pair a copilot layout card reads through.
 * Vitest entry point: the sibling `.test.ts`.
 *
 * The fixtures are the `F3.80` demo networks (`packages/db/src/network-demo-seed.ts`), in the
 * write body's shape. Their keys are spelled with an underscore (`grid_cb`), as in the seed
 * since `F4.263`, because `MIMIC_LAYOUT_NODE_KEY` refuses a hyphen in a body.
 */

type Tuple = [key: string, symbol: string, label: string, role: string | null, isSource: boolean, isSwitching: boolean, fanOut: boolean, x: number, y: number];

function unitsOf(tuples: readonly Tuple[]): MimicLayoutWriteNode[] {
  return tuples.map(([key, symbol, label, role, isSource, isSwitching, fanOut, x, y]) => ({
    key,
    kind: "unit",
    symbol,
    label,
    ...(role !== null ? { roleCode: role } : {}),
    x,
    y,
    w: 20,
    h: 25,
    z: 10,
    ...(fanOut ? { fanOut: true } : {}),
    ...(isSource ? { isSource: true } : {}),
    ...(isSwitching ? { isSwitching: true } : {}),
  })) as MimicLayoutWriteNode[];
}

const T = true;
const F = false;

/** The `F3.80` HT/LT network: fourteen units, fifteen pipes, a grid and a DG source. */
export const HT_LT_WRITE_BODY: MimicLayoutWriteBody = {
  name: "RSMOC-WC HT/LT network",
  slug: "network-demo-ht-lt",
  canvasW: 240,
  canvasH: 160,
  symbolLibraries: ["core"],
  nodes: unitsOf([
    ["grid_cb", "breaker", "Grid incomer", "ht-incomer-breaker", T, F, F, 20, 0],
    ["dg_cb", "breaker", "DG breaker", "dg-breaker", F, F, F, 170, 0],
    ["dg", "generator", "DG set", "dg-set", T, F, F, 210, 0],
    ["bus_a", "switchboard", "HT bus A", null, F, F, F, 20, 27],
    ["coupler", "breaker", "Bus coupler", "bus-coupler", F, F, F, 95, 27],
    ["bus_b", "switchboard", "HT bus B", null, F, F, F, 170, 27],
    ["out_cb_a", "breaker", "Outgoing A", "ht-outgoing-breaker", F, F, F, 20, 54],
    ["iso_b", "breaker", "Isolator B", "isolator", F, F, F, 170, 54],
    ["tr_a", "transformer", "Transformer A", "transformer", F, F, F, 20, 81],
    ["tr_b", "transformer", "Transformer B", null, F, F, F, 170, 81],
    ["lt_a", "switchboard", "LT panel A", "lt-panel", F, F, F, 20, 108],
    ["lt_b", "switchboard", "LT panel B", null, F, F, F, 170, 108],
    ["fdr_a", "breaker", "LT A feeders", "load-feeder-breaker", F, F, T, 20, 135],
    ["fdr_b", "breaker", "LT B mains feeder", "mains-feeder-breaker", F, F, F, 170, 135],
  ]),
  pipes: [
    ["grid_cb", "bus_a"],
    ["bus_a", "coupler"],
    ["coupler", "bus_b"],
    ["bus_b", "coupler"],
    ["coupler", "bus_a"],
    ["dg", "dg_cb"],
    ["dg_cb", "bus_b"],
    ["bus_a", "out_cb_a"],
    ["out_cb_a", "tr_a"],
    ["tr_a", "lt_a"],
    ["lt_a", "fdr_a"],
    ["bus_b", "iso_b"],
    ["iso_b", "tr_b"],
    ["tr_b", "lt_b"],
    ["lt_b", "fdr_b"],
  ].map(([fromKey, toKey]) => ({ fromKey: fromKey as string, toKey: toKey as string })),
};

/** The `F3.80` flow network: eight units on core and QET, three switching valves and a damper. */
export const FLOW_WRITE_BODY: MimicLayoutWriteBody = {
  name: "RSMOC-WC flow network",
  slug: "network-demo-flow",
  canvasW: 190,
  canvasH: 60,
  symbolLibraries: ["core", "qet"],
  nodes: unitsOf([
    ["pump", "pump", "Pump", "pump", T, F, F, 10, 0],
    ["header", "tank", "Header", null, F, F, F, 40, 0],
    ["iso_v1", "valve", "Isolation valve", "isolation-valve", F, T, F, 70, 0],
    ["tank_a", "tank", "Tank A", null, F, F, F, 100, 0],
    ["cv", "valve", "Control valve", "control-valve", F, T, F, 70, 32],
    ["ahu", "ahu", "AHU", null, F, F, F, 100, 32],
    ["damper", "qet:air-damper", "Damper", "damper", F, T, F, 130, 32],
    ["zone", "discharge", "Zone", null, F, F, F, 160, 32],
  ]),
  pipes: [
    ["pump", "header"],
    ["header", "iso_v1"],
    ["iso_v1", "tank_a"],
    ["header", "cv"],
    ["cv", "ahu"],
    ["ahu", "damper"],
    ["damper", "zone"],
  ].map(([fromKey, toKey]) => ({ fromKey: fromKey as string, toKey: toKey as string })),
};

/** Both fixtures are bodies the route accepts (so a card built from one could apply). */
export function theFixturesAreRouteBodies(): void {
  for (const body of [HT_LT_WRITE_BODY, FLOW_WRITE_BODY]) {
    const parsed = putMimicLayoutBodySchema.safeParse({ version: 1, ...body });
    expect(parsed.success, parsed.success ? body.slug : JSON.stringify(parsed.error.issues)).toBe(true);
  }
}

/** `toWriteBody(editorLayoutFromWriteBody(b))` is `b` for the HT/LT network. */
export function theHtLtBodyRoundTrips(): void {
  expect(toWriteBody(editorLayoutFromWriteBody(HT_LT_WRITE_BODY))).toEqual(HT_LT_WRITE_BODY);
}

/** And for the flow network (a second library, switching units). */
export function theFlowBodyRoundTrips(): void {
  expect(toWriteBody(editorLayoutFromWriteBody(FLOW_WRITE_BODY))).toEqual(FLOW_WRITE_BODY);
}

/** An absent field reads as the store writes it: `null` for the three nullable ones, `0` for `z`, `false` for each flag. */
export function anAbsentFieldReadsAsTheStoreWritesIt(): void {
  const layout = editorLayoutFromWriteBody({
    name: "L",
    slug: "l",
    canvasW: 40,
    canvasH: 40,
    symbolLibraries: ["core"],
    nodes: [{ key: "p", kind: "panel", label: "P", tone: "info", x: 0, y: 0, w: 10, h: 10 }],
    pipes: [],
  });
  expect(layout.nodes[0]).toEqual({
    key: "p",
    kind: "panel",
    symbol: null,
    label: "P",
    roleCode: null,
    tone: "info",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 0,
    fanOut: false,
    isSource: false,
    isSwitching: false,
    pointKeys: [],
  });
}

/**
 * `F4.307` — a save replaces the whole layout, so a list the editor drops is a list the save
 * clears. A roled unit's `pointKeys` round-trips in its order; an empty list is not sent.
 */
export function aUnitPointListRoundTrips(): void {
  const body: MimicLayoutWriteBody = {
    name: "L",
    slug: "l",
    canvasW: 40,
    canvasH: 40,
    symbolLibraries: ["core"],
    nodes: [
      { key: "u1", kind: "unit", symbol: "tank", label: "U1", roleCode: "ro", x: 0, y: 0, w: 10, h: 10, z: 0, pointKeys: ["level", "flow"] },
      { key: "u2", kind: "unit", symbol: "tank", label: "U2", roleCode: "ro", x: 20, y: 0, w: 10, h: 10, z: 0 },
    ],
    pipes: [],
  };
  const out = toWriteBody(editorLayoutFromWriteBody(body));
  expect(out).toEqual(body);
  expect(out.nodes[1]).not.toHaveProperty("pointKeys");
}

/**
 * `F4.307` — a unit whose role was cleared lists no points: the save body carries no
 * `pointKeys` for it (a role-less unit with a list is a 400), and the reducer clears the list
 * when the role is cleared.
 */
export function aRoleLessUnitSendsNoList(): void {
  const body: MimicLayoutWriteBody = {
    name: "L",
    slug: "l",
    canvasW: 40,
    canvasH: 40,
    symbolLibraries: ["core"],
    nodes: [{ key: "u1", kind: "unit", symbol: "tank", label: "U1", roleCode: "ro", x: 0, y: 0, w: 10, h: 10, z: 0, pointKeys: ["kw"] }],
    pipes: [],
  };
  const layout = editorLayoutFromWriteBody(body);
  const cleared = editorReducer(initialEditorState(layout), { type: "update-node", key: "u1", patch: { roleCode: null } }).layout;
  expect(cleared.nodes[0]?.pointKeys).toEqual([]);
  const stale = { ...layout, nodes: layout.nodes.map((n) => ({ ...n, roleCode: null })) };
  const out = toWriteBody(stale);
  expect(out.nodes[0]).not.toHaveProperty("pointKeys");
  expect(putMimicLayoutBodySchema.safeParse({ version: 1, ...out }).success).toBe(true);
}

/** A roled unit `u1`, a panel `p1` and a label `l1`, the unit listing `["kw"]`. */
function pointListLayout(): EditorLayout {
  return editorLayoutFromWriteBody({
    name: "L",
    slug: "l",
    canvasW: 60,
    canvasH: 40,
    symbolLibraries: ["core"],
    nodes: [
      { key: "u1", kind: "unit", symbol: "tank", label: "U1", roleCode: "ro", x: 0, y: 0, w: 10, h: 10, z: 10, pointKeys: ["kw"] },
      { key: "p1", kind: "panel", label: "P1", tone: "info", x: 20, y: 0, w: 10, h: 10, z: 0 },
      { key: "l1", kind: "label", label: "L1", x: 40, y: 0, w: 10, h: 3, z: 20 },
    ],
    pipes: [],
  });
}

function listAfter(key: string, patch: EditorNodePatch, layout: EditorLayout = pointListLayout()): readonly string[] | undefined {
  return editorReducer(initialEditorState(layout), { type: "update-node", key, patch }).layout.nodes.find((n) => n.key === key)
    ?.pointKeys;
}

/** `F4.307` T8 — `update-node` stores a roled unit's list in the order given. */
export function updateNodeStoresAUnitsList(): void {
  expect(listAfter("u1", { pointKeys: ["flow", "kw"] })).toEqual(["flow", "kw"]);
  expect(listAfter("u1", { pointKeys: [] })).toEqual([]);
  // A patch without the field keeps the list.
  expect(listAfter("u1", { label: "Renamed" })).toEqual(["kw"]);
}

/** `F4.307` T8 — the list is deduped (first place kept) and clamped to `MIMIC_HEADLINE_POINTS`. */
export function updateNodeDedupesAndClampsTheList(): void {
  expect(MIMIC_HEADLINE_POINTS).toBe(3);
  expect(listAfter("u1", { pointKeys: ["a", "b", "a", "c"] })).toEqual(["a", "b", "c"]);
  expect(listAfter("u1", { pointKeys: ["a", "b", "c", "d", "e"] })).toEqual(["a", "b", "c"]);
}

/** `F4.307` T8 — a panel and a label ignore `pointKeys`; a role-less unit takes none. */
export function updateNodeIgnoresTheListOffARoledUnit(): void {
  expect(listAfter("p1", { pointKeys: ["kw"] })).toEqual([]);
  expect(listAfter("l1", { pointKeys: ["kw"] })).toEqual([]);
  expect(listAfter("u1", { roleCode: null, pointKeys: ["kw"] })).toEqual([]);
}

/** `F4.307` T8 — a started preset lists no points (ruling Q2): its units draw the top rank. */
export function fromPresetListsNoPoints(): void {
  const layout = fromPreset("lv_single_line");
  expect(layout.nodes.length).toBeGreaterThan(0);
  expect(layout.nodes.filter((n) => n.pointKeys.length > 0).map((n) => n.key)).toEqual([]);
}

/** `F4.307` T8 — a stored layout keeps its unit's list as the editor holds it. */
export function layoutFromDtoKeepsTheList(): void {
  const editor = pointListLayout();
  const dto: MimicLayoutDto = {
    ...editor,
    nodes: [...editor.nodes],
    pipes: [...editor.pipes],
    symbolLibraries: [...editor.symbolLibraries],
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    version: 3,
    orgSymbols: [],
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-05T00:00:00.000Z",
  };
  expect(layoutFromDto(dto).nodes.find((n) => n.key === "u1")?.pointKeys).toEqual(["kw"]);
}
