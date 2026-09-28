import { mimicWidgetNodesSchema } from "./mimic";
import {
  MIMIC_LAYOUT_BOUNDS,
  mimicLayoutGeometrySchema,
  mimicPanelToneSchema,
  mimicSymbolSchema,
} from "./mimic-layouts";

/**
 * `F3.32c` / ADR 0081 — the layout library contracts and the `mimic-nodes` union on `source`
 * (plan D3, D4, D12).
 *
 * Assertions live here; `mimic-layouts.test.ts` is the Vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function issuesOf(result: { success: boolean; error?: { issues: unknown } }): string {
  return JSON.stringify(result.success ? null : result.error?.issues);
}

const WIDGET_ID = "11111111-1111-4111-8111-111111111111";
const LAYOUT_ID = "44444444-4444-4444-8444-444444444444";

const unitNode = {
  key: "clarifier",
  kind: "unit",
  symbol: "clarifier",
  label: "Clarifier",
  roleCode: "clarifier",
  tone: null,
  x: 10,
  y: 20,
  w: 20,
  h: 25,
  z: 1,
};

const panelNode = {
  key: "pretreatment",
  kind: "panel",
  symbol: null,
  label: "Pre-treatment",
  roleCode: null,
  tone: "info",
  x: 0,
  y: 0,
  w: 60,
  h: 60,
  z: 0,
};

const geometry = {
  name: "Water train",
  canvasW: 120,
  canvasH: 80,
  nodes: [panelNode, unitNode],
  pipes: [],
};

/** The closed symbol set, in the order the database CHECK restates it (plan D12). */
export function mimicSymbolsAreTheTwelveInOrder(): void {
  const expected = [
    "tank",
    "clarifier",
    "membrane",
    "vessel",
    "tower",
    "aeration",
    "dosing",
    "pump",
    "discharge",
    "valve",
    "filter",
    "unit",
  ];
  assert(
    JSON.stringify(mimicSymbolSchema.options) === JSON.stringify(expected),
    `the symbol set must be the twelve in order, got ${JSON.stringify(mimicSymbolSchema.options)}`,
  );
}

/** A panel tint is one of three colour roles. */
export function mimicPanelTonesAreThree(): void {
  assert(
    JSON.stringify(mimicPanelToneSchema.options) === JSON.stringify(["info", "neutral", "accent"]),
    `the panel tones must be info, neutral, accent, got ${JSON.stringify(mimicPanelToneSchema.options)}`,
  );
}

/** One grid cell is ten pixels (owner ruling OQ5). */
export function mimicLayoutCellIsTen(): void {
  assert(MIMIC_LAYOUT_BOUNDS.cell === 10, `a grid cell is 10 px, got ${MIMIC_LAYOUT_BOUNDS.cell}`);
}

/** A panel carries no symbol: the geometry accepts `symbol: null`. */
export function mimicLayoutGeometryParsesAPanelWithANullSymbol(): void {
  const result = mimicLayoutGeometrySchema.safeParse(geometry);
  assert(result.success, `a geometry holding a panel with symbol null must parse, got ${issuesOf(result)}`);
}

/** The preset arm of the resolver's widget union parses. */
export function mimicWidgetNodesParsesThePresetArm(): void {
  const result = mimicWidgetNodesSchema.safeParse({
    source: "preset",
    widgetId: WIDGET_ID,
    preset: "water_train",
    nodes: [],
  });
  assert(result.success, `the preset widget arm must parse, got ${issuesOf(result)}`);
}

/** The layout arm of the resolver's widget union parses, with its geometry. */
export function mimicWidgetNodesParsesTheLayoutArm(): void {
  const result = mimicWidgetNodesSchema.safeParse({
    source: "layout",
    widgetId: WIDGET_ID,
    layoutId: LAYOUT_ID,
    layout: geometry,
    nodes: [],
  });
  assert(result.success, `the layout widget arm must parse, got ${issuesOf(result)}`);
}

/** A layout arm without `layout` gives the renderer nothing to draw. */
export function mimicWidgetNodesRefusesALayoutArmWithoutLayout(): void {
  const result = mimicWidgetNodesSchema.safeParse({
    source: "layout",
    widgetId: WIDGET_ID,
    layoutId: LAYOUT_ID,
    nodes: [],
  });
  assert(!result.success, "a layout widget arm without its layout geometry must be refused");
}
