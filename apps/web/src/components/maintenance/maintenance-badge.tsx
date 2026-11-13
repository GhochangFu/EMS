import { StatusPill } from "../status-pill";

/**
 * `F4.359` (plan D18) — the badge on a suppressed alarm: the existing `info` tone, no new colour role.
 * Callers key it on `alarm.suppressed`, never on `maintenanceWindowId` (a returned alarm keeps its window id).
 */
export function MaintenanceBadge() {
  return <StatusPill label="Maintenance" tone="info" />;
}
