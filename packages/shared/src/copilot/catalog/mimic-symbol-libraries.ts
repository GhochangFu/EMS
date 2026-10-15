import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.87` (ADR 0099 Amendment 3 A1, A3) — the symbol library writes. PR 2
 * adds the area with every route pending; PR 6 makes them entries, the symbol
 * upload as the catalog's first multipart entry (`upload`).
 */
export const MIMIC_SYMBOL_LIBRARY_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.87 PR 6: not yet an entry";

export const MIMIC_SYMBOL_LIBRARY_PENDING: readonly ExcludedRoute[] = [
  { method: "PUT", path: "/mimic-symbol-libraries/settings/:libraryCode", reason: PENDING },
  { method: "POST", path: "/mimic-symbol-libraries", reason: PENDING },
  { method: "PATCH", path: "/mimic-symbol-libraries/:id", reason: PENDING },
  { method: "POST", path: "/mimic-symbol-libraries/:id/symbols", reason: PENDING },
  { method: "PATCH", path: "/mimic-symbol-libraries/:id/symbols/:symbolId", reason: PENDING },
];
