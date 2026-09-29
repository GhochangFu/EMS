import { mimicSymbolSchema } from "@bms/shared/contracts";

import { MIMIC_SYMBOL_GROUPS, MIMIC_SYMBOL_LABELS, symbolLabel } from "./mimic-symbols";

/**
 * `F3.32d` / ADR 0082 decisions 1 and 2 — the symbol labels and the palette groups. One claim
 * per exported `run*`; `mimic-symbols.test.ts` gives each its own `it()`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Every one of the twenty-nine symbols has a non-empty label. */
export function runEverySymbolHasALabel(): void {
  const symbols = mimicSymbolSchema.options;
  assert(symbols.length === 29, `expected 29 symbols, got ${symbols.length}`);
  for (const symbol of symbols) {
    assert((MIMIC_SYMBOL_LABELS[symbol] ?? "").trim() !== "", `symbol ${symbol} has no label`);
  }
}

/** No two symbols share a label: a palette button is named by its label. */
export function runLabelsAreDistinct(): void {
  const labels = mimicSymbolSchema.options.map((s) => MIMIC_SYMBOL_LABELS[s]);
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

/** The groups partition the symbol set: each symbol is in exactly one group. */
export function runGroupsPartitionTheSymbols(): void {
  const grouped = MIMIC_SYMBOL_GROUPS.flatMap((g) => g.symbols);
  assert(grouped.length === mimicSymbolSchema.options.length, `grouped ${grouped.length} symbols`);
  assert(new Set(grouped).size === grouped.length, `a symbol is in two groups: ${JSON.stringify(grouped)}`);
  for (const symbol of mimicSymbolSchema.options) {
    assert(grouped.includes(symbol), `symbol ${symbol} is in no group`);
  }
}

/** The existing symbols go where decision 2 puts them. */
export function runExistingSymbolsKeepTheirGroups(): void {
  const byKey = new Map(MIMIC_SYMBOL_GROUPS.map((g) => [g.key, g.symbols] as const));
  const water = ["tank", "clarifier", "membrane", "vessel", "aeration", "dosing", "discharge", "filter"];
  assert(JSON.stringify(byKey.get("water")) === JSON.stringify(water), `water: ${JSON.stringify(byKey.get("water"))}`);
  assert(JSON.stringify(byKey.get("hvac")) === JSON.stringify(["tower", "chiller", "ahu", "fan"]), "hvac group");
  assert(JSON.stringify(byKey.get("general")) === JSON.stringify(["pump", "valve", "unit"]), "general group");
}
