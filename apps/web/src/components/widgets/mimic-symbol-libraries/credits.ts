import type { MimicSymbolLibraryCode } from "@bms/shared";

import { DRAWIO_SYMBOL_CREDITS } from "./drawio.credits.generated";
import { QET_SYMBOL_CREDITS } from "./qet.credits.generated";
import { WMPID_SYMBOL_CREDITS } from "./wmpid.credits.generated";

/**
 * `F3.32f` / ADR 0086 decision 9 (plan D3) — the per-file credits of the third-party libraries:
 * each symbol's author, source file, licence, pin and adaptation note, which the attributions page lists. The
 * `*.credits.generated.ts` modules are written by `scripts/mimic-symbols/generate.mjs`; a library
 * without per-file credits (core, Tabler, Lucide, MDI) has no entry.
 */
export type MimicSymbolCredit = {
  readonly author: string;
  readonly source: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly pin: string;
  /** How the file was changed to become a glyph (CC BY 3.0 §4(b), CC BY 4.0 §3(a)(1)(B)). */
  readonly adaptation: string;
};

export const MIMIC_LIBRARY_CREDITS: Readonly<
  Partial<Record<MimicSymbolLibraryCode, Readonly<Record<string, MimicSymbolCredit>>>>
> = {
  qet: QET_SYMBOL_CREDITS,
  wmpid: WMPID_SYMBOL_CREDITS,
  drawio: DRAWIO_SYMBOL_CREDITS,
};

/** A library's credits by key, sorted by key; empty for a library without per-file credits. */
export function libraryCredits(code: MimicSymbolLibraryCode): ReadonlyArray<{ readonly key: string } & MimicSymbolCredit> {
  return Object.entries(MIMIC_LIBRARY_CREDITS[code] ?? {})
    .map(([key, credit]) => ({ key, ...credit }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
