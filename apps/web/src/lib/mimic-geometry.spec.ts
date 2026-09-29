import { expect } from "vitest";

import { mimicPresetSchema } from "@bms/shared/contracts";
import { MIMIC_PRESETS, type MimicLayoutGeometryDto, type MimicLayoutNodeDto } from "@bms/shared";

import { MIMIC_NODE_GLYPHS, MIMIC_NODE_SIZE, pipePath } from "./mimic";
import {
  EMPTY_GEOMETRY,
  layoutGeometry,
  orthogonalPipePath,
  presetGeometry,
  unitScale,
  type MimicBox,
} from "./mimic-geometry";

/**
 * `F3.32c` U4 — the pure geometry both mimic sources draw from (ADR 0081, plan D10).
 *
 * The preset cases pin LITERALS read off the `F3.32b` drawing, never values recomputed through
 * the helpers `presetGeometry` calls, so a change to the drawing reddens here. jsdom has no
 * layout, so every coordinate a layout draws at is asserted in this file.
 */

/** G1 — the preset's units are its eight nodes in preset order, each a 200 × 250 slot at its F3.32b corner. */
export function presetUnitsAreTheF332bSlots(): void {
  const g = presetGeometry("water_train");
  expect(g.units.map((u) => [u.key, u.box.x, u.box.y, u.box.w, u.box.h])).toEqual([
    ["water_intake", 40, 44, 200, 250],
    ["wtp", 285, 44, 200, 250],
    ["ro", 530, 44, 200, 250],
    ["softener", 775, 44, 200, 250],
    ["water_storage", 1020, 44, 200, 250],
    ["cooling_tower", 1020, 410, 200, 250],
    ["stp", 765, 410, 200, 250],
    ["etp", 510, 410, 200, 250],
  ]);
  expect(g.units.map((u) => u.roleCode)).toEqual(MIMIC_PRESETS.water_train.nodes.map((n) => n.roleCode));
  expect(g.units.map((u) => u.label)).toEqual(MIMIC_PRESETS.water_train.nodes.map((n) => n.label));
  for (const u of g.units) {
    expect(u.symbol, u.key).toBe(MIMIC_NODE_GLYPHS.water_train[u.key as keyof typeof MIMIC_NODE_GLYPHS.water_train]);
  }
}

/** G2 — the preset's viewBox, label and three panel frames, exactly as F3.32b drew them. */
export function presetPanelsAreTheF332bFrames(): void {
  const g = presetGeometry("water_train");
  expect([g.label, g.viewBox, g.width, g.height]).toEqual(["Water train", "0 0 1260 680", 1260, 680]);
  expect(g.panels).toEqual([
    { key: "treatment", label: "Water treatment", tone: "info", box: { x: 24, y: 10, w: 1212, h: 292 } },
    { key: "utilities", label: "Utilities", tone: "neutral", box: { x: 1004, y: 376, w: 232, h: 292 } },
    { key: "wastewater", label: "Wastewater", tone: "accent", box: { x: 364, y: 376, w: 617, h: 292 } },
  ]);
  expect(g.units.map((u) => [u.key, u.panelKey, u.tone])).toEqual([
    ["water_intake", "treatment", "info"],
    ["wtp", "treatment", "info"],
    ["ro", "treatment", "info"],
    ["softener", "treatment", "info"],
    ["water_storage", "treatment", "info"],
    ["cooling_tower", "utilities", "neutral"],
    ["stp", "wastewater", "accent"],
    ["etp", "wastewater", "accent"],
  ]);
  expect(g.labels).toEqual([]);
}

/** G3 — the preset's seven pipes, the pump and the sink, to the character. */
export function presetPipesPumpAndSinkAreTheF332bDrawing(): void {
  const g = presetGeometry("water_train");
  expect(g.pipes).toEqual([
    { from: "water_intake", to: "wtp", d: "M240 130 H285" },
    { from: "wtp", to: "ro", d: "M485 130 H530" },
    { from: "ro", to: "softener", d: "M730 130 H775" },
    { from: "softener", to: "water_storage", d: "M975 130 H1020" },
    { from: "water_storage", to: "cooling_tower", d: "M1120 294 V352 H1120 V410" },
    { from: "water_storage", to: "stp", d: "M1120 294 V352 H865 V410" },
    { from: "stp", to: "etp", d: "M765 496 H710" },
  ]);
  expect(g.pumps).toEqual([{ from: "water_intake", to: "wtp", at: { x: 262.5, y: 130 } }]);
  expect(g.sink).toEqual({ from: "etp", label: "Discharge", at: { x: 450, y: 496 }, d: "M510 496 H450" });
}

/** G4 — a 200 × 250 box is the slot itself; a narrower box scales down and centres vertically. */
export function unitScaleFitsTheSlotUniformly(): void {
  expect(unitScale({ x: 40, y: 44, w: 200, h: 250 })).toEqual({ s: 1, ox: 40, oy: 44 });
  expect(unitScale({ x: 10, y: 20, w: 100, h: 250 })).toEqual({ s: 0.5, ox: 10, oy: 82.5 });
  expect(unitScale({ x: 0, y: 0, w: 400, h: 250 })).toEqual({ s: 1, ox: 100, oy: 0 });
}

const A: MimicBox = { x: 0, y: 0, w: 200, h: 250 };
const B: MimicBox = { x: 400, y: 0, w: 100, h: 125 };
const C: MimicBox = { x: 300, y: 400, w: 100, h: 250 };

/** G5 — same row, different sizes: edge to edge at the upstream symbol's height, both directions. */
export function sameRowPipeRunsFromTheUpstreamSymbol(): void {
  expect(orthogonalPipePath(A, B)).toBe("M200 86 H400");
  expect(orthogonalPipePath(B, A)).toBe("M400 43 H200");
}

/** G6 — across rows, different sizes: slot bottom to slot top going down, top to bottom going up. */
export function crossRowPipeRunsBetweenTheScaledSlots(): void {
  expect(orthogonalPipePath(A, C)).toBe("M100 250 V356.25 H350 V462.5");
  expect(orthogonalPipePath(C, A)).toBe("M350 462.5 V356.25 H100 V250");
}

/** G7 — for two 200 × 250 slots the router is `pipePath`, same row and across rows, both ways. */
export function routerEqualsPipePathForSlots(): void {
  const { w, h } = MIMIC_NODE_SIZE;
  const slot = (x: number, y: number): MimicBox => ({ x, y, w, h });
  for (const [a, b] of [
    [{ x: 0, y: 0 }, { x: 300, y: 0 }],
    [{ x: 300, y: 0 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 400, y: 300 }],
    [{ x: 400, y: 300 }, { x: 0, y: 0 }],
  ] as const) {
    expect(orthogonalPipePath(slot(a.x, a.y), slot(b.x, b.y))).toBe(pipePath(a, b));
  }
}

function layoutNode(
  key: string,
  kind: MimicLayoutNodeDto["kind"],
  box: [number, number, number, number],
  extra: Partial<MimicLayoutNodeDto> = {},
): MimicLayoutNodeDto {
  const [x, y, w, h] = box;
  return { key, kind, symbol: null, label: key, roleCode: null, tone: null, x, y, w, h, z: 0, ...extra };
}

/**
 * A stored layout: `pump_b` (passive, half-width) is listed FIRST at z 2, so a renderer that kept
 * the server's order over `z` draws it first; `out` sits outside the panel; one pipe names a
 * label and one a key that does not exist.
 */
export const LAYOUT: MimicLayoutGeometryDto = {
  name: "Plant B",
  canvasW: 120,
  canvasH: 60,
  nodes: [
    layoutNode("pump_b", "unit", [30, 5, 10, 25], { symbol: "pump", z: 2 }),
    layoutNode("plant", "panel", [1, 1, 60, 40], { tone: "accent", label: "Plant" }),
    layoutNode("tank_a", "unit", [3, 5, 20, 25], { symbol: "tank", roleCode: "water_intake", z: 1, label: "Tank A" }),
    layoutNode("title", "label", [2, 45, 30, 3], { label: "Line 1" }),
    layoutNode("out", "unit", [80, 5, 20, 25], { symbol: "discharge", z: 1, label: "Discharge" }),
  ],
  pipes: [
    { fromKey: "tank_a", toKey: "pump_b" },
    { fromKey: "pump_b", toKey: "out" },
    { fromKey: "tank_a", toKey: "title" },
    { fromKey: "ghost", toKey: "out" },
  ],
};

/** G8 — grid units × cell: the viewBox and every box are ten times the stored grid values. */
export function layoutScalesByTheCell(): void {
  const g = layoutGeometry(LAYOUT);
  expect([g.label, g.viewBox, g.width, g.height]).toEqual(["Plant B", "0 0 1200 600", 1200, 600]);
  expect(g.units.map((u) => [u.key, u.box])).toEqual([
    ["tank_a", { x: 30, y: 50, w: 200, h: 250 }],
    ["out", { x: 800, y: 50, w: 200, h: 250 }],
    ["pump_b", { x: 300, y: 50, w: 100, h: 250 }],
  ]);
  expect(g.panels).toEqual([{ key: "plant", label: "Plant", tone: "accent", box: { x: 10, y: 10, w: 600, h: 400 } }]);
  expect(g.labels).toEqual([{ key: "title", text: "Line 1", box: { x: 20, y: 450, w: 300, h: 30 } }]);
}

/** G9 — a unit inside a panel takes its tone and key; outside it is neutral; a passive unit keeps `null`. */
export function layoutUnitsTakeTheirPanel(): void {
  const g = layoutGeometry(LAYOUT);
  expect(g.units.map((u) => [u.key, u.panelKey, u.tone, u.roleCode, u.symbol])).toEqual([
    ["tank_a", "plant", "accent", "water_intake", "tank"],
    ["out", null, "neutral", null, "discharge"],
    ["pump_b", "plant", "accent", null, "pump"],
  ]);
}

/** G10 — pipes run between units only, routed by `orthogonalPipePath`; no pump and no sink. */
export function layoutPipesJoinUnitsOnly(): void {
  const g = layoutGeometry(LAYOUT);
  expect(g.pipes).toEqual([
    { from: "tank_a", to: "pump_b", d: "M230 136 H300" },
    { from: "pump_b", to: "out", d: "M400 155.5 H800" },
  ]);
  expect(g.pumps).toEqual([]);
  expect(g.sink).toBeNull();
}

/** The six presets of `F3.32d` (ADR 0082 decision 3) — every preset but `water_train`. */
const DOMAIN_PRESETS = mimicPresetSchema.options.filter((p) => p !== "water_train");

/** G12 — each domain preset draws one unit per preset node, in preset order. */
export function domainPresetsDrawEveryNode(): void {
  expect(DOMAIN_PRESETS).toHaveLength(6);
  for (const p of DOMAIN_PRESETS) {
    expect(presetGeometry(p).units.map((u) => u.key), p).toEqual(MIMIC_PRESETS[p].nodes.map((n) => n.key));
  }
}

/** G13 — each domain preset draws every preset pipe; `environment_monitoring` draws none. */
export function domainPresetsDrawEveryPipe(): void {
  for (const p of DOMAIN_PRESETS) {
    expect(presetGeometry(p).pipes, p).toHaveLength(MIMIC_PRESETS[p].pipes.length);
  }
  expect(presetGeometry("environment_monitoring").pipes).toEqual([]);
}

/** G14 — a domain preset has no sink (ADR 0082 decision 3: only `water_train` has one). */
export function domainPresetsDrawNoSink(): void {
  for (const p of DOMAIN_PRESETS) {
    expect(presetGeometry(p).sink, p).toBeNull();
  }
}

/** G15 — a domain preset draws no pump (plan D3: `pumps: []`). */
export function domainPresetsDrawNoPump(): void {
  for (const p of DOMAIN_PRESETS) {
    expect(presetGeometry(p).pumps, p).toEqual([]);
  }
}

/** G16 — a domain preset's drawing is named by the preset's label. */
export function domainPresetsAreNamedByTheirLabel(): void {
  for (const p of DOMAIN_PRESETS) {
    expect(presetGeometry(p).label, p).toBe(MIMIC_PRESETS[p].label);
  }
}

/** G17 — a domain preset's units draw the symbols `MIMIC_NODE_GLYPHS` names for them. */
export function domainPresetsDrawTheirGlyphs(): void {
  for (const p of DOMAIN_PRESETS) {
    const glyphs = MIMIC_NODE_GLYPHS[p] as Readonly<Record<string, string>>;
    for (const u of presetGeometry(p).units) {
      expect(u.symbol, `${p}.${u.key}`).toBe(glyphs[u.key]);
    }
  }
}

/** G11 — the empty geometry draws nothing. */
export function emptyGeometryHoldsNothing(): void {
  expect([
    EMPTY_GEOMETRY.units.length,
    EMPTY_GEOMETRY.panels.length,
    EMPTY_GEOMETRY.labels.length,
    EMPTY_GEOMETRY.pipes.length,
    EMPTY_GEOMETRY.pumps.length,
  ]).toEqual([0, 0, 0, 0, 0]);
  expect(EMPTY_GEOMETRY.sink).toBeNull();
}
