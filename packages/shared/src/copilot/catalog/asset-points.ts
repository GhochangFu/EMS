import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the asset points (point mappings).
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link ASSET_POINT_PENDING}; the PR moves it to {@link ASSET_POINT_ENTRIES}.
 */
export const ASSET_POINT_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3b";
const MULTIPART = "a multipart upload; the interceptor refuses multipart";
const MULTI_TARGET = "a multi-target write; one card names one target — a later row (ruling Q6)";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const ASSET_POINT_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/asset-points", reason: PENDING },
  { method: "PATCH", path: "/admin/asset-points/:id", reason: PENDING },
  { method: "POST", path: "/admin/asset-points/:id/deactivate", reason: PENDING },
  { method: "POST", path: "/admin/asset-points/:id/reactivate", reason: PENDING },
  { method: "POST", path: "/admin/asset-points/mapping-sheet/preview", reason: MULTIPART },
  { method: "POST", path: "/admin/asset-points/mapping-sheet/commit", reason: MULTIPART },
  { method: "POST", path: "/admin/asset-points/bulk-update", reason: MULTI_TARGET },
];
