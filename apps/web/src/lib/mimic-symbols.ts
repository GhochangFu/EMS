import type { MimicSymbol } from "@bms/shared";

/**
 * `F3.32d` / ADR 0082 decisions 1 and 2 — each unit symbol's label, and the palette groups.
 *
 * A group is a way to find a symbol, never a limit: every symbol is usable in every layout, and
 * the group is not stored (decision 2). Both tables are typed over `MimicSymbol`, so a symbol
 * added to the contract without a label is a compile error here; `mimic-symbols.spec.ts` holds
 * that the groups partition the symbol set.
 */

/** Symbol → its label in the palette and the inspector. Acronyms keep their capitals. */
export const MIMIC_SYMBOL_LABELS: Readonly<Record<MimicSymbol, string>> = {
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
  readonly symbols: readonly MimicSymbol[];
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

/** A symbol's label: `clarifier` → `Clarifier`, `ups` → `UPS`. */
export function symbolLabel(symbol: MimicSymbol): string {
  return MIMIC_SYMBOL_LABELS[symbol];
}
