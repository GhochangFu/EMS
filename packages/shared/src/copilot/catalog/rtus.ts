import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the RTUs.
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link RTU_PENDING}; the PR moves it to {@link RTU_ENTRIES}.
 */
export const RTU_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3a";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const RTU_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/admin/rtus", reason: PENDING },
  { method: "PATCH", path: "/admin/rtus/:id", reason: PENDING },
  { method: "POST", path: "/admin/rtus/:id/deactivate", reason: PENDING },
  { method: "POST", path: "/admin/rtus/:id/reactivate", reason: PENDING },
];
