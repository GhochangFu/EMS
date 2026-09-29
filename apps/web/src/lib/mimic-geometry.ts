import { MIMIC_LAYOUT_BOUNDS } from "@bms/shared/contracts";
import {
  MIMIC_PRESETS,
  type MimicLayoutGeometryDto,
  type MimicLayoutNodeDto,
  type MimicPanelTone,
  type MimicPreset,
  type MimicPresetDef,
  type MimicSymbol,
} from "@bms/shared";

import {
  MIMIC_LAYOUTS,
  MIMIC_NODE_GLYPHS,
  MIMIC_NODE_SIZE,
  MIMIC_PANELS,
  MIMIC_PIPE_Y,
  mimicPanelBox,
  pipeMidpoint,
  pipePath,
  sinkPath,
  type MimicPoint,
} from "./mimic";

/**
 * `F3.32c` U4 (ADR 0081, plan D10) — one drawing model for both mimic sources.
 *
 * A `MimicGeometry` is everything `MimicScene` draws, already in viewBox units: the units (each a
 * box the 200 × 250 unit slot is scaled into, `unitScale`), the tinted panels, the free labels,
 * the pipes with their path `d`, the drawn pumps and the sink. `presetGeometry` builds it from
 * the preset tables in `lib/mimic.ts` and reproduces the `F3.32b` drawing exactly (the literal
 * pins in `mimic-geometry.spec.ts`); `layoutGeometry` builds it from a stored layout, scaled by
 * `MIMIC_LAYOUT_BOUNDS.cell` and routed by `orthogonalPipePath`.
 *
 * Pure: no React, no DOM — jsdom has no layout, so every coordinate is asserted here.
 */

/** A rectangle in viewBox units. */
export type MimicBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/**
 * One drawn unit. `roleCode` `null` is a passive unit (plan D6): its symbol draws, no status and
 * no values. `tone` is the tint of the panel the unit sits in (`neutral` when none); `panelKey`
 * names that panel, so the scene groups the unit under it.
 */
export type MimicGeometryUnit = {
  readonly key: string;
  readonly label: string;
  readonly symbol: MimicSymbol;
  readonly roleCode: string | null;
  readonly box: MimicBox;
  readonly tone: MimicPanelTone;
  readonly panelKey: string | null;
};

export type MimicGeometryPanel = {
  readonly key: string;
  readonly label: string;
  readonly tone: MimicPanelTone;
  readonly box: MimicBox;
};

export type MimicGeometryLabel = { readonly key: string; readonly text: string; readonly box: MimicBox };

/** A pipe in flow direction, between two unit keys. */
export type MimicGeometryPipe = { readonly from: string; readonly to: string; readonly d: string };

/** A drawn pump — decoration at a pipe's midpoint, not a unit (F3.32 ruling 1). */
export type MimicGeometryPump = { readonly from: string; readonly to: string; readonly at: MimicPoint };

/** The preset's drawn sink after a unit: its pipe, its arrow tip `at`, and its label. */
export type MimicGeometrySink = {
  readonly from: string;
  readonly label: string;
  readonly at: MimicPoint;
  readonly d: string;
};

/**
 * What `MimicScene` draws. `label` is the drawing's name in its accessible label — the preset's
 * label, or the layout's name.
 */
export type MimicGeometry = {
  readonly label: string;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
  readonly units: readonly MimicGeometryUnit[];
  readonly panels: readonly MimicGeometryPanel[];
  readonly labels: readonly MimicGeometryLabel[];
  readonly pipes: readonly MimicGeometryPipe[];
  readonly pumps: readonly MimicGeometryPump[];
  readonly sink: MimicGeometrySink | null;
};

/** Nothing to draw: a layout widget before its geometry is resolved. */
export const EMPTY_GEOMETRY: MimicGeometry = {
  label: "Plant mimic",
  viewBox: "0 0 1200 800",
  width: 1200,
  height: 800,
  units: [],
  panels: [],
  labels: [],
  pipes: [],
  pumps: [],
  sink: null,
};

/**
 * How the 200 × 250 unit slot fits a unit's box: uniform scale `s = min(w/200, h/250)`, centred.
 * `ox`/`oy` are the slot's top-left corner in viewBox units. A preset box is the slot itself, so
 * `s` is 1 and the offset is the box's corner.
 */
export function unitScale(box: MimicBox): { s: number; ox: number; oy: number } {
  const s = Math.min(box.w / MIMIC_NODE_SIZE.w, box.h / MIMIC_NODE_SIZE.h);
  return {
    s,
    ox: box.x + (box.w - MIMIC_NODE_SIZE.w * s) / 2,
    oy: box.y + (box.h - MIMIC_NODE_SIZE.h * s) / 2,
  };
}

/** The scaled slot's pipe points: the symbol's centre height, and the slot's top and bottom. */
function anchors(box: MimicBox): { cx: number; pipeY: number; top: number; bottom: number } {
  const { s, oy } = unitScale(box);
  return {
    cx: box.x + box.w / 2,
    pipeY: oy + MIMIC_PIPE_Y * s,
    top: oy,
    bottom: oy + MIMIC_NODE_SIZE.h * s,
  };
}

/**
 * An SVG path `d` between two unit boxes, in flow direction — the box generalisation of
 * `pipePath`, and equal to it for two 200 × 250 boxes.
 *
 * - **Same row** (the boxes share height and lie side by side): edge to edge at the upstream
 *   symbol's centre height, clamped into the downstream box so the line lands on it.
 * - **Across rows**: out of the upstream slot's bottom (or top) centre, along the middle of the
 *   gap, into the downstream slot's top (or bottom) centre.
 * - **Overlapping boxes** (a drawing error the editor allows mid-edit): centre to centre, one bend.
 */
export function orthogonalPipePath(from: MimicBox, to: MimicBox): string {
  const a = anchors(from);
  const b = anchors(to);
  const shareRows = Math.max(from.y, to.y) < Math.min(from.y + from.h, to.y + to.h);
  if (shareRows) {
    const y = Math.min(Math.max(a.pipeY, to.y), to.y + to.h);
    if (to.x >= from.x + from.w) {
      return `M${from.x + from.w} ${y} H${to.x}`;
    }
    if (to.x + to.w <= from.x) {
      return `M${from.x} ${y} H${to.x + to.w}`;
    }
    return `M${a.cx} ${a.pipeY} H${b.cx} V${b.pipeY}`;
  }
  const down = to.y > from.y;
  const y0 = down ? a.bottom : a.top;
  const y1 = down ? b.top : b.bottom;
  return `M${a.cx} ${y0} V${(y0 + y1) / 2} H${b.cx} V${y1}`;
}

function slotBox(at: MimicPoint): MimicBox {
  return { x: at.x, y: at.y, w: MIMIC_NODE_SIZE.w, h: MIMIC_NODE_SIZE.h };
}

function viewBoxSize(viewBox: string): { width: number; height: number } {
  const [, , width = 0, height = 0] = viewBox.split(" ").map(Number);
  return { width, height };
}

/**
 * A preset's drawing. `sink` is optional on both the preset and its layout (`F3.32d`, ADR 0082
 * decision 3): a preset without one draws no sink and widens no panel, and `water_train`, which
 * has one, draws exactly as before.
 */
function buildPresetGeometry(preset: MimicPreset): MimicGeometry {
  const def: MimicPresetDef = MIMIC_PRESETS[preset];
  const layout = MIMIC_LAYOUTS[preset];
  const at = layout.nodes as Readonly<Record<string, MimicPoint>>;
  const sinkAt = def.sink !== undefined && layout.sink !== undefined ? layout.sink : null;
  const sinkFromKey = sinkAt === null ? null : (def.sink?.from ?? null);
  const glyphs = MIMIC_NODE_GLYPHS[preset] as Readonly<Record<string, MimicSymbol>>;
  const presetPanels = MIMIC_PANELS[preset];
  const panelOf = new Map<string, { key: string; tone: MimicPanelTone }>(
    presetPanels.flatMap((p) => p.nodes.map((k) => [k, { key: p.key, tone: p.tone }] as const)),
  );

  const units = def.nodes.flatMap((n): MimicGeometryUnit[] => {
    const pos = at[n.key];
    if (pos === undefined) {
      return [];
    }
    const panel = panelOf.get(n.key);
    return [
      {
        key: n.key,
        label: n.label,
        symbol: glyphs[n.key] ?? "vessel",
        roleCode: n.roleCode,
        box: slotBox(pos),
        tone: panel?.tone ?? "neutral",
        panelKey: panel?.key ?? null,
      },
    ];
  });

  const panels = presetPanels.flatMap((p): MimicGeometryPanel[] => {
    const box = mimicPanelBox(
      p.nodes.flatMap((k) => (at[k] === undefined ? [] : [at[k] as MimicPoint])),
      sinkFromKey !== null && (p.nodes as readonly string[]).includes(sinkFromKey) ? sinkAt : null,
    );
    return box === null ? [] : [{ key: p.key, label: p.label, tone: p.tone, box }];
  });

  const pipes = def.pipes.flatMap((p): MimicGeometryPipe[] => {
    const from = at[p.from];
    const to = at[p.to];
    return from === undefined || to === undefined ? [] : [{ from: p.from, to: p.to, d: pipePath(from, to) }];
  });

  const pumps = layout.pumps.flatMap((p): MimicGeometryPump[] => {
    const from = at[p.from];
    const to = at[p.to];
    const mid = from === undefined || to === undefined ? null : pipeMidpoint(from, to);
    return mid === null ? [] : [{ from: p.from, to: p.to, at: mid }];
  });

  const sinkFrom = sinkFromKey === null ? undefined : at[sinkFromKey];
  const sink: MimicGeometrySink | null =
    sinkFrom === undefined || sinkAt === null || def.sink === undefined
      ? null
      : { from: def.sink.from, label: def.sink.label, at: sinkAt, d: sinkPath(sinkFrom, sinkAt) };

  return {
    label: def.label,
    viewBox: layout.viewBox,
    ...viewBoxSize(layout.viewBox),
    units,
    panels,
    labels: [],
    pipes,
    pumps,
    sink,
  };
}

const PRESET_GEOMETRY = new Map<MimicPreset, MimicGeometry>();

/** A preset's drawing — computed once per preset; the `F3.32b` drawing, unchanged. */
export function presetGeometry(preset: MimicPreset): MimicGeometry {
  const cached = PRESET_GEOMETRY.get(preset);
  if (cached !== undefined) {
    return cached;
  }
  const built = buildPresetGeometry(preset);
  PRESET_GEOMETRY.set(preset, built);
  return built;
}

function scaled(node: MimicLayoutNodeDto): MimicBox {
  const { cell } = MIMIC_LAYOUT_BOUNDS;
  return { x: node.x * cell, y: node.y * cell, w: node.w * cell, h: node.h * cell };
}

function contains(box: MimicBox, p: MimicPoint): boolean {
  return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
}

/**
 * A stored layout's drawing. Grid units × `MIMIC_LAYOUT_BOUNDS.cell` → viewBox units; nodes in
 * `z` order (stable, so equal `z` keeps the server's order). A unit belongs to the topmost panel
 * holding its box's centre — that panel's tone tints its symbol and the scene groups it there;
 * outside every panel it is `neutral` and ungrouped. A pipe naming a key that is not a unit is
 * skipped, never drawn to nowhere. No pumps and no sink: a layout draws a pump or a discharge as
 * a unit.
 */
export function layoutGeometry(layout: MimicLayoutGeometryDto): MimicGeometry {
  const { cell } = MIMIC_LAYOUT_BOUNDS;
  const width = layout.canvasW * cell;
  const height = layout.canvasH * cell;
  const ordered = layout.nodes
    .map((node, i) => ({ node, i }))
    .sort((a, b) => a.node.z - b.node.z || a.i - b.i)
    .map(({ node }) => node);

  const panels: MimicGeometryPanel[] = ordered
    .filter((n) => n.kind === "panel")
    .map((n) => ({ key: n.key, label: n.label, tone: n.tone ?? "neutral", box: scaled(n) }));
  const labels: MimicGeometryLabel[] = ordered
    .filter((n) => n.kind === "label")
    .map((n) => ({ key: n.key, text: n.label, box: scaled(n) }));
  const units: MimicGeometryUnit[] = ordered
    .filter((n) => n.kind === "unit")
    .map((n) => {
      const box = scaled(n);
      const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const panel = [...panels].reverse().find((p) => contains(p.box, centre));
      return {
        key: n.key,
        label: n.label,
        symbol: n.symbol ?? "unit",
        roleCode: n.roleCode,
        box,
        tone: panel?.tone ?? "neutral",
        panelKey: panel?.key ?? null,
      };
    });

  const boxOf = new Map(units.map((u) => [u.key, u.box]));
  const pipes = layout.pipes.flatMap((p): MimicGeometryPipe[] => {
    const from = boxOf.get(p.fromKey);
    const to = boxOf.get(p.toKey);
    return from === undefined || to === undefined || p.fromKey === p.toKey
      ? []
      : [{ from: p.fromKey, to: p.toKey, d: orthogonalPipePath(from, to) }];
  });

  return {
    label: layout.name,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    units,
    panels,
    labels,
    pipes,
    pumps: [],
    sink: null,
  };
}
