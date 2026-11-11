import type { UserRole } from "@bms/shared";

/**
 * Write classes for the operations surface (ADR 0017).
 *
 * - `configuration` changes what the system *will* do, indefinitely, for
 *   everyone: rule authoring, maintenance-schedule definition, and
 *   `rules/evaluate` (which runs every enabled rule and can raise alarms).
 * - `operational` records what *did* happen, or acts on today's work: alarm
 *   acknowledgement, work-order lifecycle, executing a due schedule.
 * - `approval` (`E3.1`, ADR 0122 decision 6.2) signs off, sends back or ends a work
 *   order: `POST /work-orders/:id/close`, `/reject` and `/cancel`. The person who did
 *   the work (`operational`) is not, by that alone, the person who accepts it.
 */
export type OperationsWriteClass = "configuration" | "operational" | "approval";

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
  admin: { configuration: true, operational: true, approval: true },
  organization_admin: { configuration: true, operational: true, approval: true },
  location_admin: { configuration: true, operational: true, approval: true },
  asset_group_admin: { configuration: true, operational: true, approval: true },
  // Useful for today's work; powerless over what the system will do tomorrow, and
  // never the one who approves, rejects or cancels a work order (ruling Q10).
  operator: { configuration: false, operational: true, approval: false },
  viewer: { configuration: false, operational: false, approval: false },
};

/** The 403 body of a refused approval-class write. Never includes user data. */
export const OPERATIONS_APPROVAL_DENIAL = "Approving, rejecting or cancelling a work order requires an administrator role";

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
  switch (writeClass) {
    case "configuration":
      return "Changing rules and maintenance schedules requires an administrator role";
    case "approval":
      return OPERATIONS_APPROVAL_DENIAL;
    case "operational":
      return "Recording operations activity requires an operator or administrator role";
  }
}

/**
 * `E3.1` (ADR 0122 decision 3.2, owner ruling of 2026-11-11) — who may send `slaMinutes`
 * on `POST /work-orders`, the SLA override of one ticket: the four admin roles. An
 * `operator` creates tickets (`operational`) but may not choose their own deadline; an
 * operator's ticket takes the organization's policy or the platform default.
 *
 * It is exactly the roles that hold `configuration`, and it is stated through that
 * class on purpose: a role added to the matrix must decide `configuration` there, and
 * this follows it.
 */
export function canOverrideWorkOrderSla(role: UserRole): boolean {
  return canPerformOperationsWrite(role, "configuration");
}

/** The 403 body of a refused SLA override. Never includes user data. */
export const WORK_ORDER_SLA_OVERRIDE_DENIAL = "Setting the SLA of a single work order requires an administrator role";
