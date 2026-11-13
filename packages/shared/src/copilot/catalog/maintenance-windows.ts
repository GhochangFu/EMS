import type { ExcludedRoute } from "./types";

/**
 * `F4.359` / ADR 0131 — the maintenance-window writes. ADR 0099 Amendment 19
 * makes all four Copilot catalog entries; until that amendment's build (plan PR
 * 6) they stay on the exclusion list, as Amendment 17 decision 5 kept the
 * payload-format writes out until its own build. PR 6 moves them from here into
 * entries.
 */
const PENDING_AMENDMENT_19 = "copilot entry in ADR 0099 Amendment 19";

export const MAINTENANCE_WINDOW_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/maintenance-windows", reason: PENDING_AMENDMENT_19 },
  { method: "POST", path: "/maintenance-windows/:id/extend", reason: PENDING_AMENDMENT_19 },
  { method: "POST", path: "/maintenance-windows/:id/end", reason: PENDING_AMENDMENT_19 },
  { method: "POST", path: "/maintenance-windows/:id/cancel", reason: PENDING_AMENDMENT_19 },
];
