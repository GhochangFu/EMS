import type { UserRole } from "@bms/shared";

/**
 * Write classes for the operations surface (ADR 0017).
 *
 * - `configuration` changes what the system *will* do, indefinitely, for
 *   everyone: rule authoring, maintenance-schedule definition, and
 *   `rules/evaluate` (which runs every enabled rule and can raise alarms).
 * - `operational` records what *did* happen, or acts on today's work: alarm
 *   acknowledgement, work-order lifecycle, executing a due schedule.
 */
export type OperationsWriteClass = "configuration" | "operational";

/**
 * The ADR 0017 matrix.
 *
 * `Record<UserRole, …>` is load-bearing: adding a role to the `UserRole` union
 * without deciding its writes here is a compile error. Before this gate, the
 * mutating handlers in rules/alarms/work-orders/maintenance carried
 * `JwtAuthGuard` and no role check, so a new role would silently have inherited
 * full write access.
 */
const WRITE_MATRIX: Record<UserRole, Record<OperationsWriteClass, boolean>> = {
  admin: { configuration: true, operational: true },
  organization_admin: { configuration: true, operational: true },
  location_admin: { configuration: true, operational: true },
  asset_group_admin: { configuration: true, operational: true },
  // Useful for today's work; powerless over what the system will do tomorrow.
  operator: { configuration: false, operational: true },
  viewer: { configuration: false, operational: false },
};

/** Returns true when the role may perform the given class of operations write. */
export function canPerformOperationsWrite(
  role: UserRole,
  writeClass: OperationsWriteClass,
): boolean {
  return WRITE_MATRIX[role]?.[writeClass] ?? false;
}

/** Human-readable reason used in the 403 body. Never includes user data. */
export function operationsWriteDenialReason(
  writeClass: OperationsWriteClass,
): string {
  return writeClass === "configuration"
    ? "Changing rules and maintenance schedules requires an administrator role"
    : "Recording operations activity requires an operator or administrator role";
}
