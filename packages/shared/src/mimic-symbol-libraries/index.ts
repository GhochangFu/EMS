import type { z } from "zod";

import type { MimicSymbolGroupCode, mimicSymbolLibraryCodeSchema, mimicSymbolSchema } from "../contracts/mimic-layouts";
import { LUCIDE_SYMBOL_KEYS, LUCIDE_SYMBOL_META } from "./lucide.generated";
import { MDI_SYMBOL_KEYS, MDI_SYMBOL_META } from "./mdi.generated";
import { TABLER_SYMBOL_KEYS, TABLER_SYMBOL_META } from "./tabler.generated";

/**
 * `F3.32e` / ADR 0084 — the preloaded mimic symbol libraries. Code, not a contract (the
 * `./mimic-presets` precedent): the registry the editor offers, the save refuses against, and
 * migration `0090`'s `bms.mimic_symbol_libraries` rows restate.
 *
 * The three `*.generated.ts` siblings are written by `scripts/mimic-symbols/generate.mjs`; their
 * path data lives in `apps/web` (decision 5), so this package holds keys, labels and groups only.
 * No library label names the product (ADR 0084 decision 4 as amended; ADR 0083).
 */

type LibraryCode = z.infer<typeof mimicSymbolLibraryCodeSchema>;
type SymbolKey = z.infer<typeof mimicSymbolSchema>;

/** One library: what the palette tab names, and how its glyphs draw (decision 6). */
export type MimicSymbolLibrary = {
  readonly code: LibraryCode;
  readonly label: string;
  readonly source: string;
  readonly version: string;
  readonly licence: string;
  readonly attributionUrl: string;
  readonly style: "stroke" | "fill";
  readonly sortOrder: number;
};

/** The four libraries in palette order; `0090`'s library rows restate these values. */
export const MIMIC_SYMBOL_LIBRARIES: readonly MimicSymbolLibrary[] = [
  {
    code: "core",
    label: "Core",
    source: "Built in",
    version: "1",
    licence: "Own drawings",
    attributionUrl: "",
    style: "stroke",
    sortOrder: 10,
  },
  {
    code: "tabler",
    label: "Tabler Icons",
    source: "@tabler/icons",
    version: "3.48.0",
    licence: "MIT",
    attributionUrl: "https://tabler.io/icons",
    style: "stroke",
    sortOrder: 20,
  },
  {
    code: "lucide",
    label: "Lucide",
    source: "lucide-static",
    version: "1.48.0",
    licence: "ISC and MIT",
    attributionUrl: "https://lucide.dev",
    style: "stroke",
    sortOrder: 30,
  },
  {
    code: "mdi",
    label: "Material Design Icons",
    source: "@mdi/svg",
    version: "7.4.47",
    licence: "Apache 2.0",
    attributionUrl: "https://pictogrammers.com/library/mdi/",
    style: "fill",
    sortOrder: 40,
  },
];

/** One library symbol as the palette lists it. */
export type MimicLibrarySymbolEntry = {
  readonly key: SymbolKey;
  readonly label: string;
  readonly group: MimicSymbolGroupCode;
};

function entriesOf<K extends SymbolKey>(
  keys: readonly K[],
  meta: Readonly<Record<K, { readonly label: string; readonly group: MimicSymbolGroupCode }>>,
): readonly MimicLibrarySymbolEntry[] {
  return keys.map((key) => ({ key, label: meta[key].label, group: meta[key].group }));
}

const ENTRIES: Readonly<Record<Exclude<LibraryCode, "core">, readonly MimicLibrarySymbolEntry[]>> = {
  tabler: entriesOf(TABLER_SYMBOL_KEYS, TABLER_SYMBOL_META),
  lucide: entriesOf(LUCIDE_SYMBOL_KEYS, LUCIDE_SYMBOL_META),
  mdi: entriesOf(MDI_SYMBOL_KEYS, MDI_SYMBOL_META),
};

const LABELS: ReadonlyMap<string, string> = new Map(
  Object.values(ENTRIES)
    .flat()
    .map((entry) => [entry.key, entry.label]),
);

/** The library a key belongs to: the part before `:`, or `core` for a bare key (decision 2). */
export function libraryOfSymbol(key: string): LibraryCode {
  const colon = key.indexOf(":");
  if (colon < 0) return "core";
  const code = key.slice(0, colon);
  return code === "tabler" || code === "lucide" || code === "mdi" ? code : "core";
}

/** A library by code; the registry holds every code the contract names. */
export function mimicSymbolLibrary(code: LibraryCode): MimicSymbolLibrary {
  const library = MIMIC_SYMBOL_LIBRARIES.find((l) => l.code === code);
  if (!library) throw new Error(`mimic symbol library ${code} is not in the registry`);
  return library;
}

/**
 * A non-core library's symbols, in curation order. The core library's labels and groups are the
 * web's own tables (`apps/web/src/lib/mimic-symbols.ts`), so `core` answers an empty list here.
 */
export function librarySymbolEntries(code: LibraryCode): readonly MimicLibrarySymbolEntry[] {
  return code === "core" ? [] : ENTRIES[code];
}

/** A library key's label (`mdi:heat-pump` → "Heat pump"); `null` for a core or unknown key. */
export function symbolLibraryLabel(key: string): string | null {
  return LABELS.get(key) ?? null;
}

export * from "./lucide.generated";
export * from "./mdi.generated";
export * from "./tabler.generated";
