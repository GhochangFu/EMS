import { LUCIDE_SYMBOL_KEYS } from "../mimic-symbol-libraries/lucide.generated";
import { MDI_SYMBOL_KEYS } from "../mimic-symbol-libraries/mdi.generated";
import { TABLER_SYMBOL_KEYS } from "../mimic-symbol-libraries/tabler.generated";
import { mimicWidgetNodesSchema } from "./mimic";
import {
  MIMIC_LAYOUT_BOUNDS,
  MIMIC_SYMBOL_GROUP_CODES,
  mimicCoreSymbolSchema,
  mimicLayoutDtoSchema,
  mimicLayoutGeometrySchema,
  mimicPanelToneSchema,
  mimicSymbolLibraryCodeSchema,
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

/** The core symbol set, in the order migration 0090's core rows restate it (plan D12, ADR 0082). */
export function mimicCoreSymbolsAreTheTwentyNineInOrder(): void {
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
    "transformer",
    "breaker",
    "switchboard",
    "generator",
    "meter",
    "motor",
    "ups",
    "battery",
    "rack",
    "chiller",
    "ahu",
    "fan",
    "compressor",
    "boiler",
    "sensor",
    "lamp",
    "lift",
  ];
  assert(
    JSON.stringify(mimicCoreSymbolSchema.options) === JSON.stringify(expected),
    `the core set must be the twenty-nine in order, got ${JSON.stringify(mimicCoreSymbolSchema.options)}`,
  );
}

/** `F3.32e` / ADR 0084 — every symbol is the core set, then each library's keys in registry order. */
export function mimicSymbolSchemaIsCoreThenEachLibraryInRegistryOrder(): void {
  const expected = [...mimicCoreSymbolSchema.options, ...TABLER_SYMBOL_KEYS, ...LUCIDE_SYMBOL_KEYS, ...MDI_SYMBOL_KEYS];
  assert(expected.length >= 29 + 300, `only ${expected.length} symbols`);
  assert(JSON.stringify(mimicSymbolSchema.options) === JSON.stringify(expected), "the symbol union is out of order");
  assert(new Set(expected).size === expected.length, "a symbol key repeats");
}

/** A library key names its library and fits `mimic_layout_nodes.symbol`'s varchar(64). */
export function everyLibraryKeyNamesItsLibraryAndFitsSixtyFour(): void {
  const byLibrary = { tabler: TABLER_SYMBOL_KEYS, lucide: LUCIDE_SYMBOL_KEYS, mdi: MDI_SYMBOL_KEYS };
  for (const [code, keys] of Object.entries(byLibrary)) {
    assert(keys.length >= 100, `${code} has ${keys.length} keys`);
    for (const key of keys) {
      assert(key.startsWith(`${code}:`), `${key} does not name ${code}`);
      assert(key.length <= 64, `${key} is longer than 64`);
    }
  }
  for (const key of mimicCoreSymbolSchema.options) {
    assert(!key.includes(":"), `core key ${key} has a colon`);
  }
}

/** The four libraries of ADR 0084 decision 4, in palette order. */
export function libraryCodesAreTheFour(): void {
  const codes = mimicSymbolLibraryCodeSchema.options;
  assert(JSON.stringify(codes) === JSON.stringify(["core", "tabler", "lucide", "mdi"]), `codes: ${JSON.stringify(codes)}`);
}

/** The eight palette groups of ADR 0082 decision 2, in order. */
export function groupCodesAreTheEight(): void {
  const expected = ["water", "electrical", "it_ups", "hvac", "mechanical", "environment", "facility", "general"];
  assert(JSON.stringify(MIMIC_SYMBOL_GROUP_CODES) === JSON.stringify(expected), "group codes changed");
}

const storedLayout = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Plant",
  slug: "plant",
  canvasW: 120,
  canvasH: 80,
  version: 1,
  nodes: [],
  pipes: [],
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

/** A layout DTO carries its chosen libraries (ADR 0084 decision 8). */
export function mimicLayoutDtoParsesSymbolLibraries(): void {
  const parsed = mimicLayoutDtoSchema.safeParse({ ...storedLayout, symbolLibraries: ["core", "mdi"] });
  assert(parsed.success, `a DTO with symbolLibraries must parse: ${JSON.stringify(parsed.error?.issues)}`);
  assert(JSON.stringify(parsed.data?.symbolLibraries) === '["core","mdi"]', "symbolLibraries did not survive the parse");
}

/** A DTO naming a library the registry lacks does not parse. */
export function mimicLayoutDtoRefusesAnUnknownLibraryCode(): void {
  const parsed = mimicLayoutDtoSchema.safeParse({ ...storedLayout, symbolLibraries: ["core", "zzz"] });
  assert(!parsed.success, "a DTO naming library zzz parsed");
  assert(
    parsed.error?.issues.some((issue) => issue.path.join(".") === "symbolLibraries.1") ?? false,
    `the refusal must point at symbolLibraries.1: ${JSON.stringify(parsed.error?.issues)}`,
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
