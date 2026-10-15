import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.87` (ADR 0099 Amendment 3 A1, A6) — the unit-role vocabulary. PR 2 adds
 * the area with the create pending; PR 6 makes `assetRole.create` an entry
 * for the global admin. The role edit and retire stay on their page
 * (`EXCLUDED_ROUTES`).
 */
export const ASSET_ROLE_ENTRIES: readonly CatalogEntry[] = [];

export const ASSET_ROLE_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/vocabularies/asset-roles", reason: "F3.87 PR 6: not yet an entry" },
];
