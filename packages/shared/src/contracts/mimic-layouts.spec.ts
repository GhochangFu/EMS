import { DRAWIO_SYMBOL_KEYS } from "../mimic-symbol-libraries/drawio.generated";
import { LUCIDE_SYMBOL_KEYS } from "../mimic-symbol-libraries/lucide.generated";
import { MDI_SYMBOL_KEYS } from "../mimic-symbol-libraries/mdi.generated";
import { QET_SYMBOL_KEYS } from "../mimic-symbol-libraries/qet.generated";
import { TABLER_SYMBOL_KEYS } from "../mimic-symbol-libraries/tabler.generated";
import { WMPID_SYMBOL_KEYS } from "../mimic-symbol-libraries/wmpid.generated";
import { mimicWidgetNodesSchema } from "./mimic";
import {
  MIMIC_LAYOUT_BOUNDS,
  MIMIC_SYMBOL_GROUP_CODES,
  mimicCoreSymbolSchema,
  mimicLayoutDtoSchema,
  mimicLayoutGeometrySchema,
  mimicPanelToneSchema,
  mimicSymbolLibraryCodeSchema,
  mimicStaticSymbolSchema,
  mimicSymbolSchema,
} from "./mimic-layouts";
import { validOrgSymbol } from "./mimic-symbol-libraries.spec";

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
  fanOut: false,
  isSource: false,
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
  fanOut: false,
  isSource: false,
};

const geometry = {
  name: "Water train",
  canvasW: 120,
  canvasH: 80,
  nodes: [panelNode, unitNode],
  pipes: [],
  orgSymbols: [],
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

/** `F3.32e` / ADR 0084 — every static symbol is the core set, then each library's keys in registry order. */
export function mimicSymbolSchemaIsCoreThenEachLibraryInRegistryOrder(): void {
  const expected = [
    ...mimicCoreSymbolSchema.options,
    ...TABLER_SYMBOL_KEYS,
    ...LUCIDE_SYMBOL_KEYS,
    ...MDI_SYMBOL_KEYS,
    ...QET_SYMBOL_KEYS,
    ...WMPID_SYMBOL_KEYS,
    ...DRAWIO_SYMBOL_KEYS,
  ];
  assert(expected.length >= 29 + 300, `only ${expected.length} symbols`);
  assert(JSON.stringify(mimicStaticSymbolSchema.options) === JSON.stringify(expected), "the static symbol list is out of order");
  assert(new Set(expected).size === expected.length, "a symbol key repeats");
}

/** A refused symbol answers one short message, not the 438-option list (security review L3). */
export function mimicSymbolRefusalIsShort(): void {
  const parsed = mimicSymbolSchema.safeParse("nope:x");
  assert(!parsed.success, "nope:x parsed");
  const message = parsed.error?.issues[0]?.message ?? "";
  assert(message === "Unknown mimic symbol", `message: ${message.slice(0, 80)}`);
  assert(mimicSymbolSchema.safeParse("mdi:heat-pump").success, "a known library key must still parse");
}

/** A library key names its library and fits `mimic_layout_nodes.symbol`'s varchar(64). */
export function everyLibraryKeyNamesItsLibraryAndFitsSixtyFour(): void {
  // F3.32f: the 0090 libraries hold at least 100 keys each; the slice 2 libraries' counts are
  // gated with migration 0092, so here they only name their library.
  const floors = new Set(["tabler", "lucide", "mdi"]);
  const byLibrary = {
    tabler: TABLER_SYMBOL_KEYS,
    lucide: LUCIDE_SYMBOL_KEYS,
    mdi: MDI_SYMBOL_KEYS,
    qet: QET_SYMBOL_KEYS,
    wmpid: WMPID_SYMBOL_KEYS,
    drawio: DRAWIO_SYMBOL_KEYS,
  };
  for (const [code, keys] of Object.entries(byLibrary)) {
    if (floors.has(code)) assert(keys.length >= 100, `${code} has ${keys.length} keys`);
    for (const key of keys) {
      assert(key.startsWith(`${code}:`), `${key} does not name ${code}`);
      assert(key.length <= 64, `${key} is longer than 64`);
    }
  }
  for (const key of mimicCoreSymbolSchema.options) {
    assert(!key.includes(":"), `core key ${key} has a colon`);
  }
}

/** The four libraries of ADR 0084 decision 4, then the three of ADR 0086 decision 9, in palette
 * order. Mutation: drop "drawio" from `mimicSymbolLibraryCodeSchema` → this claim reddens. */
export function libraryCodesAreTheSevenInPaletteOrder(): void {
  const codes = mimicSymbolLibraryCodeSchema.options;
  const expected = ["core", "tabler", "lucide", "mdi", "qet", "wmpid", "drawio"];
  assert(JSON.stringify(codes) === JSON.stringify(expected), `codes: ${JSON.stringify(codes)}`);
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
  orgSymbols: [],
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

/** `F3.32f` slice 3 / ADR 0086 decision 2 — a node's symbol accepts an organization key. */
export function mimicSymbolSchemaAcceptsAnOrgKey(): void {
  const parsed = mimicSymbolSchema.safeParse("org.plant:inlet");
  assert(parsed.success, `org.plant:inlet refused: ${issuesOf(parsed)}`);
  assert(mimicSymbolSchema.safeParse("tank").success, "a core key must still parse");
}

/** A library key with no name is not a symbol, and the refusal stays one short message. */
export function mimicSymbolSchemaRefusesOrgPlantWithNoName(): void {
  const parsed = mimicSymbolSchema.safeParse("org.plant");
  assert(!parsed.success, "org.plant parsed as a symbol");
  const message = parsed.error?.issues[0]?.message ?? "";
  assert(message === "Unknown mimic symbol", `message: ${message.slice(0, 80)}`);
}

/** A layout DTO embeds the organization symbols its units draw (decision 7). */
export function layoutDtoParsesOrgSymbols(): void {
  const parsed = mimicLayoutDtoSchema.safeParse({
    ...storedLayout,
    symbolLibraries: ["core", "org.plant"],
    orgSymbols: [validOrgSymbol],
  });
  assert(parsed.success, `a DTO with orgSymbols must parse: ${issuesOf(parsed)}`);
  assert(parsed.data?.orgSymbols[0]?.key === "org.plant:inlet-screen", "orgSymbols did not survive the parse");
}

/** `orgSymbols` is required: a DTO or a geometry without it does not parse (none is `[]`). */
export function layoutDtoRefusesAnAbsentOrgSymbols(): void {
  const parsed = mimicLayoutDtoSchema.safeParse({ ...storedLayout, symbolLibraries: ["core"], orgSymbols: undefined });
  assert(!parsed.success, "a DTO without orgSymbols parsed");
  // Refused for the right field: a fixture that falls behind the node schema must not
  // keep this claim green on an unrelated missing field.
  assert(
    !parsed.success && parsed.error.issues.every((issue) => issue.path[0] === "orgSymbols"),
    `the DTO must be refused at orgSymbols only, got ${JSON.stringify(parsed.success ? [] : parsed.error.issues.map((i) => i.path))}`,
  );
  const geometryParsed = mimicLayoutGeometrySchema.safeParse({ ...geometry, orgSymbols: undefined });
  assert(!geometryParsed.success, "a geometry without orgSymbols parsed");
  assert(
    !geometryParsed.success && geometryParsed.error.issues.every((issue) => issue.path[0] === "orgSymbols"),
    `the geometry must be refused at orgSymbols only, got ${JSON.stringify(geometryParsed.success ? [] : geometryParsed.error.issues.map((i) => i.path))}`,
  );
}

/** `symbolLibraries` accepts `org.<code>` beside the static codes, and not a symbol key. */
export function symbolLibrariesAcceptsOrgPlant(): void {
  const parsed = mimicLayoutDtoSchema.safeParse({ ...storedLayout, symbolLibraries: ["core", "org.plant"] });
  assert(parsed.success, `symbolLibraries ["core","org.plant"] refused: ${issuesOf(parsed)}`);
  const symbolKey = mimicLayoutDtoSchema.safeParse({ ...storedLayout, symbolLibraries: ["core", "org.plant:inlet"] });
  assert(!symbolKey.success, "a symbol key parsed as a library selection");
}
