import type { CatalogEntry, ExcludedRoute } from "./types";

/**
 * `F3.86` (ADR 0099 release 2) — the catalog entries for the two location Control Room view routes (ruling Q7(b)).
 * One file per area, so the wizard PRs never edit the same catalog file
 * (plan §4.5). Until its PR lands, each write route of the area waits in
 * {@link SITE_VIEW_PENDING}; the PR moves it to {@link SITE_VIEW_ENTRIES}.
 */
export const SITE_VIEW_ENTRIES: readonly CatalogEntry[] = [];

const PENDING = "F3.86 PR 3d";

/** The area's write routes that are not entries: waiting for their PR, or excluded for good (with the reason). */
export const SITE_VIEW_PENDING: readonly ExcludedRoute[] = [
  { method: "PUT", path: "/admin/locations/:id/control-room-view", reason: PENDING },
  { method: "POST", path: "/admin/locations/:id/site-layout", reason: PENDING },
];
