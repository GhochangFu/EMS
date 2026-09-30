import {
  librarySymbolEntries,
  MIMIC_SYMBOL_GROUP_CODES,
  mimicCoreSymbolSchema,
  type MimicOrgSymbolDto,
  type MimicOrgSymbolLibraryDto,
  type MimicSymbolLibrariesResponse,
} from "@bms/shared";

import {
  catalogOrgSymbols,
  librarySymbolGroups,
  MIMIC_CORE_SYMBOL_LABELS,
  MIMIC_SYMBOL_GROUPS,
  orgLibrarySymbolGroups,
  symbolLabel,
  symbolLabelIn,
} from "./mimic-symbols";

/**
 * `F3.32f` slice 3 — one organization symbol for a fixture: a circle in a 24-unit box. Exported
 * for the palette, inspector and page specs; it is not a `run*`, so the entry never runs it.
 */
export function orgSymbolFixture(key: MimicOrgSymbolDto["key"], label: string, active = true): MimicOrgSymbolDto {
  return {
    id: `00000000-0000-4000-8000-${String(key.length).padStart(12, "0")}`,
    libraryId: "00000000-0000-4000-8000-00000000000a",
    key,
    label,
    group: "water",
    style: "stroke",
    viewBox: [0, 0, 24, 24],
    shapes: [["circle", { cx: "12", cy: "12", r: "8" }]],
    active,
    sourceFilename: `${label}.svg`,
    sha256: "a".repeat(64),
    updatedAt: new Date(0).toISOString(),
  };
}

function orgLibraryFixture(
  code: string,
  label: string,
  active: boolean,
  symbols: MimicOrgSymbolDto[],
  id: string,
): MimicOrgSymbolLibraryDto {
  return {
    id,
    organizationId: "22222222-2222-4222-8222-222222222222",
    code,
    key: `org.${code}`,
    label,
    style: "stroke",
    licence: "CC BY 4.0",
    attribution: active ? "Drawn by the plant team" : "",
    sourceUrl: null,
    active,
    symbolCount: symbols.length,
    symbols,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * The catalog the editor specs read: four global libraries (Tabler turned off for the
 * organization), `org.plant` (active; `Inlet screen` active, `Old pump` retired) and
 * `org.legacy` (retired).
 */
export function orgCatalogFixture(): MimicSymbolLibrariesResponse {
  const global = (code: "core" | "tabler" | "lucide" | "mdi", label: string, enabled: boolean) => ({
    code,
    label,
    style: "stroke" as const,
    licence: code === "core" ? "Own drawings" : "MIT",
    active: true,
    enabled,
    inactiveSymbolKeys: [],
  });
  return {
    global: [
      global("core", "Core", true),
      global("tabler", "Tabler Icons", false),
      global("lucide", "Lucide", true),
      global("mdi", "Material Design Icons", true),
    ],
    organization: [
      orgLibraryFixture(
        "plant",
        "Plant",
        true,
        [orgSymbolFixture("org.plant:inlet", "Inlet screen"), orgSymbolFixture("org.plant:old-pump", "Old pump", false)],
        "00000000-0000-4000-8000-0000000000a1",
      ),
      orgLibraryFixture(
        "legacy",
        "Legacy",
        false,
        [orgSymbolFixture("org.legacy:gear", "Gear")],
        "00000000-0000-4000-8000-0000000000a2",
      ),
    ],
  };
}

/**
 * `F3.32d` / ADR 0082 decisions 1 and 2 — the symbol labels and the palette groups. One claim
 * per exported `run*`; `mimic-symbols.test.ts` gives each its own `it()`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Every one of the twenty-nine core symbols has a non-empty label. */
export function runEverySymbolHasALabel(): void {
  const symbols = mimicCoreSymbolSchema.options;
  assert(symbols.length === 29, `expected 29 symbols, got ${symbols.length}`);
  for (const symbol of symbols) {
    assert((MIMIC_CORE_SYMBOL_LABELS[symbol] ?? "").trim() !== "", `symbol ${symbol} has no label`);
  }
}

/** No two symbols share a label: a palette button is named by its label. */
export function runLabelsAreDistinct(): void {
  const labels = mimicCoreSymbolSchema.options.map((s) => MIMIC_CORE_SYMBOL_LABELS[s]);
  assert(new Set(labels).size === labels.length, `labels repeat: ${JSON.stringify(labels)}`);
}

/** An acronym keeps its capitals; a word is capitalised. */
export function runAcronymsKeepTheirCapitals(): void {
  assert(symbolLabel("ups") === "UPS", `ups → ${symbolLabel("ups")}`);
  assert(symbolLabel("ahu") === "AHU", `ahu → ${symbolLabel("ahu")}`);
  assert(symbolLabel("tank") === "Tank", `tank → ${symbolLabel("tank")}`);
}

/** The groups are the eight of decision 2, in order, General last. */
export function runGroupsAreTheEightInOrder(): void {
  const labels = MIMIC_SYMBOL_GROUPS.map((g) => g.label);
  const expected = ["Water", "Electrical", "IT and UPS", "HVAC", "Mechanical", "Environment", "Facility", "General"];
  assert(JSON.stringify(labels) === JSON.stringify(expected), `groups: ${JSON.stringify(labels)}`);
}

/** The groups partition the core symbol set: each core symbol is in exactly one group. */
export function runGroupsPartitionTheSymbols(): void {
  const grouped = MIMIC_SYMBOL_GROUPS.flatMap((g) => g.symbols);
  assert(grouped.length === mimicCoreSymbolSchema.options.length, `grouped ${grouped.length} symbols`);
  assert(new Set(grouped).size === grouped.length, `a symbol is in two groups: ${JSON.stringify(grouped)}`);
  for (const symbol of mimicCoreSymbolSchema.options) {
    assert(grouped.includes(symbol), `symbol ${symbol} is in no group`);
  }
}

/**
 * Every group holds the symbols ADR 0082 decisions 1 and 2 give it, in order. Pinned literally:
 * the partition claim above stays green when a symbol moves between groups.
 */
export function runEveryGroupHoldsItsSymbols(): void {
  const expected: Record<string, readonly string[]> = {
    water: ["tank", "clarifier", "membrane", "vessel", "aeration", "dosing", "discharge", "filter"],
    electrical: ["transformer", "breaker", "switchboard", "generator", "meter", "motor"],
    it_ups: ["ups", "battery", "rack"],
    hvac: ["tower", "chiller", "ahu", "fan"],
    mechanical: ["compressor", "boiler"],
    environment: ["sensor"],
    facility: ["lamp", "lift"],
    general: ["pump", "valve", "unit"],
  };
  const actual = Object.fromEntries(MIMIC_SYMBOL_GROUPS.map((g) => [g.key, g.symbols]));
  assert(JSON.stringify(actual) === JSON.stringify(expected), `groups: ${JSON.stringify(actual)}`);
}

/**
 * `F3.32e` / ADR 0084 — every library symbol has its generated label through `symbolLabel`, and
 * no two symbols of one library share one (a palette button is named by its label).
 */
export function runEveryLibrarySymbolHasALabel(): void {
  let count = 0;
  for (const code of ["tabler", "lucide", "mdi"] as const) {
    const labels = librarySymbolEntries(code).map((entry) => symbolLabel(entry.key));
    assert(labels.length >= 100, `${code} has ${labels.length} symbols`);
    assert(labels.every((label) => label.trim() !== "" && !label.includes(":")), `${code} has an unlabelled symbol`);
    assert(new Set(labels).size === labels.length, `${code} labels repeat`);
    count += labels.length;
  }
  assert(symbolLabel("mdi:heat-pump") === "Heat pump", `mdi:heat-pump → ${symbolLabel("mdi:heat-pump")}`);
  assert(count >= 300, `only ${count} library symbols`);
}

/** The web groups are the shared group codes, in order: a library symbol's group names one. */
export function runGroupKeysEqualTheSharedGroupCodes(): void {
  const keys = MIMIC_SYMBOL_GROUPS.map((g) => g.key);
  assert(JSON.stringify(keys) === JSON.stringify(MIMIC_SYMBOL_GROUP_CODES), `group keys: ${JSON.stringify(keys)}`);
}

/** Each library's groups partition that library: every symbol once, in its own group. */
export function runLibraryGroupsPartitionThatLibrary(): void {
  for (const code of ["tabler", "lucide", "mdi"] as const) {
    const entries = librarySymbolEntries(code);
    const groups = librarySymbolGroups(code);
    assert(groups.length === 8, `${code} has ${groups.length} groups`);
    const grouped = groups.flatMap((g) => g.symbols);
    assert(grouped.length === entries.length, `${code}: grouped ${grouped.length} of ${entries.length}`);
    for (const entry of entries) {
      const group = groups.find((g) => g.symbols.includes(entry.key));
      assert(group?.key === entry.group, `${entry.key} is in ${group?.key}, expected ${entry.group}`);
    }
  }
  assert(librarySymbolGroups("core") === MIMIC_SYMBOL_GROUPS, "core groups are not the core table");
}

// ---- organization symbols (F3.32f slice 3, plan D9) ------------------------------------------

/** An organization key's label is its catalog label. */
export function runSymbolLabelInAnswersTheCatalogLabel(): void {
  const label = symbolLabelIn("org.plant:inlet", catalogOrgSymbols(orgCatalogFixture()));
  assert(label === "Inlet screen", `org.plant:inlet → ${label}`);
}

/** A static key keeps `symbolLabel`'s answer. */
export function runSymbolLabelInKeepsAStaticLabel(): void {
  const label = symbolLabelIn("ups", catalogOrgSymbols(orgCatalogFixture()));
  assert(label === "UPS", `ups → ${label}`);
}

/** An organization library's groups hold its active symbols only. */
export function runOrgLibraryGroupsHoldActiveSymbolsOnly(): void {
  const plant = orgCatalogFixture().organization[0];
  if (plant === undefined) throw new Error("no plant library");
  const keys = orgLibrarySymbolGroups(plant).flatMap((group) => group.symbols.map((s) => s.key));
  assert(JSON.stringify(keys) === '["org.plant:inlet"]', `plant's palette symbols: ${JSON.stringify(keys)}`);
}
