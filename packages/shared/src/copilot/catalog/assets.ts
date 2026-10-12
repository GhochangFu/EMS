import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the assets.
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link ASSET_PENDING}; the PR moves it to {@link ASSET_ENTRIES}.
 */
export const ASSET_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3b";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const ASSET_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/assets", reason: PENDING },
  { method: "PATCH", path: "/admin/assets/:id", reason: PENDING },
  { method: "POST", path: "/admin/assets/:id/deactivate", reason: PENDING },
  { method: "POST", path: "/admin/assets/:id/reactivate", reason: PENDING },
];
