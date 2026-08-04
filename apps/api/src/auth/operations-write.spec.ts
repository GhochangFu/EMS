import type { UserRole } from "@bms/shared";

import {
  canPerformOperationsWrite,
  type OperationsWriteClass,
} from "./operations-write";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * The ADR 0017 matrix, expressed as data.
 *
 * Every role appears exactly once. Adding a role to `UserRole` without
 * deciding its writes here makes the completeness check below fail, so a new
 * role cannot silently inherit permissive behaviour — which is precisely how
 * the ungated controllers behaved before this gate existed.
 */
const MATRIX: Record<UserRole, Record<OperationsWriteClass, boolean>> = {
  admin: { configuration: true, operational: true },
  organization_admin: { configuration: true, operational: true },
  location_admin: { configuration: true, operational: true },
  asset_group_admin: { configuration: true, operational: true },
  operator: { configuration: false, operational: true },
  viewer: { configuration: false, operational: false },
};

const ALL_ROLES = Object.keys(MATRIX) as UserRole[];
const ALL_CLASSES: OperationsWriteClass[] = ["configuration", "operational"];

/** Unit checks for the operations write matrix (ADR 0017). */
export function runOperationsWriteTests(): void {
  // Every (role, class) pair behaves exactly as the ADR table says.
  for (const role of ALL_ROLES) {
    for (const writeClass of ALL_CLASSES) {
      const expected = MATRIX[role][writeClass];
      assert(
        canPerformOperationsWrite(role, writeClass) === expected,
        `${role} must ${expected ? "be allowed" : "be denied"} ${writeClass} writes`,
      );
    }
  }

  // viewer writes nothing, ever. A role literally named "viewer" gaining any
  // write path is the defect this gate exists to make impossible.
  for (const writeClass of ALL_CLASSES) {
    assert(
      !canPerformOperationsWrite("viewer", writeClass),
      `viewer must never perform ${writeClass} writes`,
    );
  }

  // No-regression guard: the four admin roles keep everything they had before
  // ADR 0017. This gate is additive — it must not take reach away from anyone.
  for (const role of [
    "admin",
    "organization_admin",
    "location_admin",
    "asset_group_admin",
  ] as UserRole[]) {
    for (const writeClass of ALL_CLASSES) {
      assert(
        canPerformOperationsWrite(role, writeClass),
        `${role} must retain ${writeClass} writes (no regression)`,
      );
    }
  }

  // operator is the whole point: useful for today's work, powerless over
  // configuration. rules/evaluate is classified `configuration` because it can
  // raise alarms across the caller's entire scope.
  assert(
    canPerformOperationsWrite("operator", "operational"),
    "operator must be able to ack alarms and run work orders",
  );
  assert(
    !canPerformOperationsWrite("operator", "configuration"),
    "operator must not author rules or trigger rule evaluation",
  );

  // Completeness: every role in the union is decided. The compile-time guard is
  // the `Record<UserRole, …>` type on WRITE_MATRIX — this only checks that the
  // spec's own copy stayed in step with it.
  assert(
    ALL_ROLES.length === 6,
    `matrix must decide every UserRole; found ${ALL_ROLES.length}`,
  );

  // Fail closed on anything outside the union. `resolveDbUser` casts
  // `row.role as UserRole`, so a bms.users row holding a stale or hand-edited
  // slug reaches this function untyped. It must be denied, not defaulted.
  for (const bogus of [
    "future_role",
    "",
    "__proto__",
    "constructor",
    "toString",
  ] as unknown as UserRole[]) {
    for (const writeClass of ALL_CLASSES) {
      assert(
        !canPerformOperationsWrite(bogus, writeClass),
        `unknown role ${JSON.stringify(bogus)} must be denied ${writeClass} writes`,
      );
    }
  }
}
