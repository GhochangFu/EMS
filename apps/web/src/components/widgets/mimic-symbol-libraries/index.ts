import { libraryOfSymbol, mimicSymbolLibrary, type MimicSymbolLibraryCode } from "@bms/shared";

import { DRAWIO_LICENCE_NOTICE, DRAWIO_SHAPES } from "./drawio.generated";
import { LUCIDE_LICENCE_NOTICE, LUCIDE_SHAPES } from "./lucide.generated";
import { MDI_LICENCE_NOTICE, MDI_SHAPES } from "./mdi.generated";
import { QET_LICENCE_NOTICE, QET_SHAPES } from "./qet.generated";
import type { MimicShape } from "./shapes";
import { TABLER_LICENCE_NOTICE, TABLER_SHAPES } from "./tabler.generated";
import { WMPID_LICENCE_NOTICE, WMPID_SHAPES } from "./wmpid.generated";

/**
 * `F3.32e` / ADR 0084 decision 5 — the vendored path data of the preloaded libraries, by key.
 * The `*.generated.ts` modules are written by `scripts/mimic-symbols/generate.mjs`; each is typed
 * over its library's key tuple in `@bms/shared`, so a key the contract has and this package lacks
 * (or the reverse) is a compile error.
 */

export * from "./credits";
export * from "./shapes";

/** A library record's entries, typed: a record over an empty key tuple (a library not yet
 * curated) is `{}`, whose `Object.entries` would read as `unknown`. */
const shapeEntries = (record: Readonly<Record<string, readonly MimicShape[]>>): Array<[string, readonly MimicShape[]]> =>
  Object.entries(record);

const SHAPES: ReadonlyMap<string, readonly MimicShape[]> = new Map<string, readonly MimicShape[]>([
  ...shapeEntries(TABLER_SHAPES),
  ...shapeEntries(LUCIDE_SHAPES),
  ...shapeEntries(MDI_SHAPES),
  ...shapeEntries(QET_SHAPES),
  ...shapeEntries(WMPID_SHAPES),
  ...shapeEntries(DRAWIO_SHAPES),
]);

/** A library key's draw style and shapes; `null` for a core key or a key no library has. */
export function librarySymbolShapes(
  key: string,
): { readonly style: "stroke" | "fill"; readonly shapes: readonly MimicShape[] } | null {
  const shapes = SHAPES.get(key);
  if (!shapes) return null;
  return { style: mimicSymbolLibrary(libraryOfSymbol(key)).style, shapes };
}

/** Each non-core library's licence notice, verbatim; the palette shows it (decision 9). */
export const MIMIC_LIBRARY_NOTICES: Readonly<Record<Exclude<MimicSymbolLibraryCode, "core">, string>> = {
  tabler: TABLER_LICENCE_NOTICE,
  lucide: LUCIDE_LICENCE_NOTICE,
  mdi: MDI_LICENCE_NOTICE,
  qet: QET_LICENCE_NOTICE,
  wmpid: WMPID_LICENCE_NOTICE,
  drawio: DRAWIO_LICENCE_NOTICE,
};
