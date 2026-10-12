import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for users and grants (risk "access").
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link USER_PENDING}; the PR moves it to {@link USER_ENTRIES}.
 */
export const USER_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 4";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const USER_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/users", reason: PENDING },
  { method: "PATCH", path: "/admin/users/:id", reason: PENDING },
  { method: "POST", path: "/admin/users/:id/deactivate", reason: PENDING },
  { method: "POST", path: "/admin/users/:id/reactivate", reason: PENDING },
  { method: "POST", path: "/admin/users/:id/grants", reason: PENDING },
  { method: "DELETE", path: "/admin/users/:id/grants/:kind/:grantId", reason: PENDING },
];
