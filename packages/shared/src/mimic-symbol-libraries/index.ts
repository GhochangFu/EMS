import type { z } from "zod";

import type { MimicSymbolGroupCode, mimicStaticSymbolSchema, mimicSymbolLibraryCodeSchema } from "../contracts/mimic-layouts";
import { MIMIC_ORG_LIBRARY_KEY, MIMIC_ORG_SYMBOL_KEY } from "../contracts/mimic-symbol-libraries";
import { DRAWIO_SYMBOL_KEYS, DRAWIO_SYMBOL_META } from "./drawio.generated";
import { LUCIDE_SYMBOL_KEYS, LUCIDE_SYMBOL_META } from "./lucide.generated";
import { MDI_SYMBOL_KEYS, MDI_SYMBOL_META } from "./mdi.generated";
import { QET_SYMBOL_KEYS, QET_SYMBOL_META } from "./qet.generated";
import { TABLER_SYMBOL_KEYS, TABLER_SYMBOL_META } from "./tabler.generated";
import { WMPID_SYMBOL_KEYS, WMPID_SYMBOL_META } from "./wmpid.generated";

/**
 * `F3.32e` / ADR 0084 — the preloaded mimic symbol libraries. Code, not a contract (the
 * `./mimic-presets` precedent): the registry the editor offers, the save refuses against, and
 * migration `0090`'s `bms.mimic_symbol_libraries` rows restate.
 *
 * The `*.generated.ts` siblings are written by `scripts/mimic-symbols/generate.mjs`; their
 * path data lives in `apps/web` (decision 5), so this package holds keys, labels and groups only.
 * No library label names the product (ADR 0084 decision 4 as amended; ADR 0083).
 */

type LibraryCode = z.infer<typeof mimicSymbolLibraryCodeSchema>;
type SymbolKey = z.infer<typeof mimicStaticSymbolSchema>;
type OrgLibraryKey = `org.${string}`;

/** `F3.32f` slice 3 (ADR 0086 decision 2): `org.<code>:<name>`, an organization library's symbol. */
export function isOrgSymbolKey(key: string): key is `org.${string}:${string}` {
  return key.length <= 64 && MIMIC_ORG_SYMBOL_KEY.test(key);
}

/** `F3.32f` slice 3: `org.<code>`, an organization library as a layout chooses it. */
export function isOrgLibraryKey(code: string): code is OrgLibraryKey {
  return MIMIC_ORG_LIBRARY_KEY.test(code);
}

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

/**
 * The seven libraries in palette order. `0090`'s library rows restate the first four (with `0091`'s
 * Lucide licence); `0092`'s the three of ADR 0086 decision 9.
 */
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
  {
    code: "qet",
    label: "QElectroTech",
    source: "qelectrotech/qelectrotech-elements",
    version: "0.100",
    licence: "CC BY 3.0",
    attributionUrl: "https://qelectrotech.org/wiki/doc/elements_license",
    style: "stroke",
    sortOrder: 50,
  },
  {
    code: "wmpid",
    label: "Wikimedia Commons P&ID",
    source: "Wikimedia Commons Category:P&ID symbols",
    version: "2026-09-29",
    licence: "Public domain / CC0",
    attributionUrl: "https://commons.wikimedia.org/wiki/Category:P%26ID_symbols",
    style: "stroke",
    sortOrder: 60,
  },
  {
    code: "drawio",
    label: "draw.io",
    source: "jgraph/drawio stencils (pid, electrical)",
    version: "29.3.2",
    licence: "CC BY 4.0",
    attributionUrl: "https://github.com/jgraph/drawio/tree/48b181339578e11da7052ebf5b1fba8499418b77/src/main/webapp/stencils",
    style: "stroke",
    sortOrder: 70,
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
  qet: entriesOf(QET_SYMBOL_KEYS, QET_SYMBOL_META),
  wmpid: entriesOf(WMPID_SYMBOL_KEYS, WMPID_SYMBOL_META),
  drawio: entriesOf(DRAWIO_SYMBOL_KEYS, DRAWIO_SYMBOL_META),
};

const LABELS: ReadonlyMap<string, string> = new Map(
  Object.values(ENTRIES)
    .flat()
    .map((entry) => [entry.key, entry.label]),
);

/**
 * The library a key belongs to: the part before `:` when the registry holds that code, else `core`
 * — a bare key, or a prefix no library has (decision 2; registry-driven since `F3.32f`). An
 * organization key answers its organization library, `org.<code>` (`F3.32f` slice 3); never pass
 * that answer to `mimicSymbolLibrary`, which knows the static registry only.
 */
export function libraryOfSymbol(key: string): LibraryCode | OrgLibraryKey {
  if (isOrgSymbolKey(key)) return key.slice(0, key.indexOf(":")) as OrgLibraryKey;
  const colon = key.indexOf(":");
  if (colon < 0) return "core";
  const prefix = key.slice(0, colon);
  return MIMIC_SYMBOL_LIBRARIES.find((library) => library.code === prefix)?.code ?? "core";
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

export * from "./drawio.generated";
export * from "./lucide.generated";
export * from "./mdi.generated";
export * from "./qet.generated";
export * from "./tabler.generated";
export * from "./wmpid.generated";
