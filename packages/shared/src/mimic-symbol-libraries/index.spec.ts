import { MIMIC_SYMBOL_GROUP_CODES, mimicSymbolLibraryCodeSchema } from "../contracts/mimic-layouts";
import {
  libraryOfSymbol,
  librarySymbolEntries,
  MIMIC_SYMBOL_LIBRARIES,
  mimicSymbolLibrary,
  symbolLibraryLabel,
} from "./index";

/**
 * `F3.32e` / ADR 0084 — the symbol library registry. Assertions live here; `index.test.ts` is
 * the Vitest entry point (ADR 0014). One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A bare key is core; a prefixed key names its library (decision 2). */
export function libraryOfSymbolReadsThePrefix(): void {
  assert(libraryOfSymbol("tank") === "core", `tank → ${libraryOfSymbol("tank")}`);
  assert(libraryOfSymbol("mdi:heat-pump") === "mdi", `mdi:heat-pump → ${libraryOfSymbol("mdi:heat-pump")}`);
  assert(libraryOfSymbol("tabler:bolt") === "tabler", `tabler:bolt → ${libraryOfSymbol("tabler:bolt")}`);
  assert(libraryOfSymbol("lucide:factory") === "lucide", `lucide:factory → ${libraryOfSymbol("lucide:factory")}`);
}

/** The registry holds every contract code, in contract order, with the decision 4 and ADR 0086
 * decision 9 styles. */
export function registryIsTheSevenLibrariesWithTheirStyles(): void {
  const codes = MIMIC_SYMBOL_LIBRARIES.map((l) => l.code);
  assert(JSON.stringify(codes) === JSON.stringify(mimicSymbolLibraryCodeSchema.options), `codes: ${JSON.stringify(codes)}`);
  const styles = MIMIC_SYMBOL_LIBRARIES.map((l) => l.style);
  assert(JSON.stringify(styles) === JSON.stringify(["stroke", "stroke", "stroke", "fill", "stroke", "stroke", "stroke"]), `styles: ${JSON.stringify(styles)}`);
  assert(mimicSymbolLibrary("mdi").licence === "Apache 2.0", "mdi licence");
  assert(mimicSymbolLibrary("lucide").licence === "ISC and MIT", "lucide licence");
}

/** F3.32f: a prefix is a library when the registry holds it (ADR 0086 decision 9). Mutation:
 * restore the hard-coded tabler/lucide/mdi check in `libraryOfSymbol` → this claim reddens. */
export function libraryOfSymbolReadsARegisteredNewPrefix(): void {
  assert(libraryOfSymbol("qet:x") === "qet", `qet:x → ${libraryOfSymbol("qet:x")}`);
}

/** F3.32f: a prefix the registry does not hold reads as core, as a bare key does. Mutation:
 * return the prefix unchecked in `libraryOfSymbol` → this claim reddens. */
export function libraryOfSymbolReadsAnUnknownPrefixAsCore(): void {
  assert(libraryOfSymbol("nope:x") === "core", `nope:x → ${libraryOfSymbol("nope:x")}`);
}

/** F3.32f: the Commons library carries its licence label (ADR 0086 decision 9). Mutation: drop
 * the wmpid registry entry → this claim reddens. */
export function wmpidLicenceIsPublicDomainOrCc0(): void {
  assert(mimicSymbolLibrary("wmpid").licence === "Public domain / CC0", `wmpid licence: ${mimicSymbolLibrary("wmpid").licence}`);
}

/** No library label names the product (ADR 0084 decision 4 as amended, ADR 0083). */
export function coreLibraryIsLabelledCore(): void {
  assert(mimicSymbolLibrary("core").label === "Core", `core label: ${mimicSymbolLibrary("core").label}`);
  for (const library of MIMIC_SYMBOL_LIBRARIES) {
    assert(!/trinetra/i.test(library.label), `${library.code} label names the product`);
  }
}

/** Every library entry has a known group and a non-empty label, unique within its library. */
export function everyEntryHasAGroupAndAUniqueLabel(): void {
  for (const code of ["tabler", "lucide", "mdi"] as const) {
    const entries = librarySymbolEntries(code);
    assert(entries.length >= 100, `${code} has ${entries.length} entries`);
    for (const entry of entries) {
      assert((MIMIC_SYMBOL_GROUP_CODES as readonly string[]).includes(entry.group), `${entry.key} group ${entry.group}`);
      assert(entry.label.trim() !== "", `${entry.key} has no label`);
    }
    const labels = entries.map((e) => e.label);
    assert(new Set(labels).size === labels.length, `${code} labels repeat`);
  }
  assert(librarySymbolEntries("core").length === 0, "core entries come from the web tables");
}

/** A library key's label is generated from its name; a core key has none here. */
export function symbolLibraryLabelReadsTheGeneratedLabel(): void {
  assert(symbolLibraryLabel("mdi:heat-pump") === "Heat pump", `mdi:heat-pump → ${symbolLibraryLabel("mdi:heat-pump")}`);
  assert(symbolLibraryLabel("mdi:molecule-co2") === "Molecule CO2", `co2 → ${symbolLibraryLabel("mdi:molecule-co2")}`);
  assert(symbolLibraryLabel("tank") === null, "a core key must have no library label");
}
