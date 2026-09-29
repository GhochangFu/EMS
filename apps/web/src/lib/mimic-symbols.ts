import {
  librarySymbolEntries,
  symbolLibraryLabel,
  type MimicCoreSymbol,
  type MimicSymbol,
  type MimicSymbolLibraryCode,
} from "@bms/shared";

/**
 * `F3.32d` / ADR 0082 decisions 1 and 2 — each unit symbol's label, and the palette groups.
 *
 * A group is a way to find a symbol, never a limit: every symbol is usable in every layout, and
 * the group is not stored (decision 2). Both tables are typed over `MimicCoreSymbol`, so a core
 * symbol added to the contract without a label is a compile error here (a library symbol's label
 * and group are generated, `@bms/shared`'s `mimic-symbol-libraries`, ADR 0084); `mimic-symbols.spec.ts` holds
 * that the groups partition the symbol set.
 */

/** Symbol → its label in the palette and the inspector. Acronyms keep their capitals. */
export const MIMIC_CORE_SYMBOL_LABELS: Readonly<Record<MimicCoreSymbol, string>> = {
  tank: "Tank",
  clarifier: "Clarifier",
  membrane: "Membrane",
  vessel: "Vessel",
  tower: "Tower",
  aeration: "Aeration",
  dosing: "Dosing",
  pump: "Pump",
  discharge: "Discharge",
  valve: "Valve",
  filter: "Filter",
  unit: "Unit",
  transformer: "Transformer",
  breaker: "Breaker",
  switchboard: "Switchboard",
  generator: "Generator",
  meter: "Meter",
  motor: "Motor",
  ups: "UPS",
  battery: "Battery",
  rack: "Rack",
  chiller: "Chiller",
  ahu: "AHU",
  fan: "Fan",
  compressor: "Compressor",
  boiler: "Boiler",
  sensor: "Sensor",
  lamp: "Lamp",
  lift: "Lift",
};

/** One palette group: a heading and its symbols, in drawing order. */
export type MimicSymbolGroup = {
  readonly key: string;
  readonly label: string;
  readonly symbols: readonly MimicCoreSymbol[];
};

/** The eight groups in ADR 0082 decision 2's order; General is last. */
export const MIMIC_SYMBOL_GROUPS: readonly MimicSymbolGroup[] = [
  {
    key: "water",
    label: "Water",
    symbols: ["tank", "clarifier", "membrane", "vessel", "aeration", "dosing", "discharge", "filter"],
  },
  {
    key: "electrical",
    label: "Electrical",
    symbols: ["transformer", "breaker", "switchboard", "generator", "meter", "motor"],
  },
  { key: "it_ups", label: "IT and UPS", symbols: ["ups", "battery", "rack"] },
  { key: "hvac", label: "HVAC", symbols: ["tower", "chiller", "ahu", "fan"] },
  { key: "mechanical", label: "Mechanical", symbols: ["compressor", "boiler"] },
  { key: "environment", label: "Environment", symbols: ["sensor"] },
  { key: "facility", label: "Facility", symbols: ["lamp", "lift"] },
  { key: "general", label: "General", symbols: ["pump", "valve", "unit"] },
];

/**
 * A symbol's label: `clarifier` → `Clarifier`, `ups` → `UPS`, and a library key's generated
 * label (`mdi:heat-pump` → `Heat pump`, ADR 0084). A key no table knows answers itself.
 */
export function symbolLabel(symbol: MimicSymbol): string {
  if (Object.prototype.hasOwnProperty.call(MIMIC_CORE_SYMBOL_LABELS, symbol)) return MIMIC_CORE_SYMBOL_LABELS[symbol as MimicCoreSymbol];
  return symbolLibraryLabel(symbol) ?? symbol;
}

/** One palette group of a library: its heading and that library's symbols in it. */
export type MimicLibrarySymbolGroup = {
  readonly key: string;
  readonly label: string;
  readonly symbols: readonly MimicSymbol[];
};

/**
 * A library's symbols in the eight groups, in `MIMIC_SYMBOL_GROUPS`' order (ADR 0084 decision 9).
 * `core` answers the core groups; a group with no symbol of the library is kept, empty — the
 * palette hides it.
 */
export function librarySymbolGroups(code: MimicSymbolLibraryCode): readonly MimicLibrarySymbolGroup[] {
  if (code === "core") return MIMIC_SYMBOL_GROUPS;
  const entries = librarySymbolEntries(code);
  return MIMIC_SYMBOL_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    symbols: entries.filter((entry) => entry.group === group.key).map((entry) => entry.key),
  }));
}
