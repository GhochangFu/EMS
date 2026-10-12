import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the asset groups and their members.
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link ASSET_GROUP_PENDING}; the PR moves it to {@link ASSET_GROUP_ENTRIES}.
 */
export const ASSET_GROUP_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3c";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const ASSET_GROUP_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/asset-groups", reason: PENDING },
  { method: "PATCH", path: "/admin/asset-groups/:id", reason: PENDING },
  { method: "POST", path: "/admin/asset-groups/:id/members", reason: PENDING },
  { method: "PATCH", path: "/admin/asset-group-members/:id", reason: PENDING },
  { method: "DELETE", path: "/admin/asset-group-members/:id", reason: PENDING },
];
