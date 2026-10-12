import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the point-key catalog (a fleet row, ruling Q1).
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link POINT_KEY_PENDING}; the PR moves it to {@link POINT_KEY_ENTRIES}.
 */
export const POINT_KEY_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3c";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const POINT_KEY_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/point-keys", reason: PENDING },
  { method: "PATCH", path: "/admin/point-keys/:id", reason: PENDING },
  { method: "POST", path: "/admin/point-keys/:id/deactivate", reason: PENDING },
  { method: "POST", path: "/admin/point-keys/:id/reactivate", reason: PENDING },
];
