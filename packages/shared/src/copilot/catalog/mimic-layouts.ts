import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.87` (ADR 0099 Amendment 3 A1, A2) — the mimic layout writes. PR 2 adds
 * the area with every route pending; PR 5 makes `mimicLayout.create` and
 * `mimicLayout.replace` entries (one whole body on one card). The layout
 * `DELETE` stays excluded for good (`EXCLUDED_ROUTES`, decision 3).
 */
export const MIMIC_LAYOUT_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.87 PR 5: not yet an entry";

export const MIMIC_LAYOUT_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/mimic-layouts", reason: PENDING },
  { method: "PUT", path: "/mimic-layouts/:id", reason: PENDING },
];
