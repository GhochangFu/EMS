import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import { expect } from "vitest";

import { locationWriteRefusalReasonSchema, locationWriteRefusalSchema } from "@bms/shared";
import type { LocationWriteRefusalReason } from "@bms/shared";

import {
  depthExceeded,
  locationTreeLockKey,
  refusal,
  treeGuardRefusal,
} from "./locations-tree-guards";

/**
 * `F2.10` (ADR 0098 Drafter choice 2, Amendment 1 A3 and C) — pure cases for
 * the locations tree guards. The write paths that call them are proved in
 * `locations.tree.integration.spec.ts`.
 */

const BAD_REQUEST: readonly LocationWriteRefusalReason[] = [
  "location_parent_not_found",
  "location_parent_cycle",
  "location_depth_exceeded",
];
const CONFLICT: readonly LocationWriteRefusalReason[] = [
  "location_parent_inactive",
  "location_has_active_children",
  "location_inactive",
];

function body(err: HttpException): unknown {
  return err.getResponse();
}

/** G1 — every reason the contract names has a class: 400 for the shape refusals, 409 for the state ones. */
export function everyReasonMapsToItsStatus(): void {
  expect([...BAD_REQUEST, ...CONFLICT].sort()).toEqual([...locationWriteRefusalReasonSchema.options].sort());
  for (const reason of BAD_REQUEST) {
    const err = refusal(reason);
    expect(err, reason).toBeInstanceOf(BadRequestException);
    expect(err.getStatus(), reason).toBe(400);
  }
  for (const reason of CONFLICT) {
    const err = refusal(reason);
    expect(err, reason).toBeInstanceOf(ConflictException);
    expect(err.getStatus(), reason).toBe(409);
  }
}

/** G2 — the body is exactly `{ message, reason }`, and parses against the shared refusal schema. */
export function everyRefusalBodyIsMessageAndReason(): void {
  for (const reason of locationWriteRefusalReasonSchema.options) {
    const response = body(refusal(reason)) as Record<string, unknown>;
    expect(Object.keys(response).sort(), reason).toEqual(["message", "reason"]);
    expect(response.reason, reason).toBe(reason);
    expect(typeof response.message === "string" && response.message.length > 0, reason).toBe(true);
    expect(locationWriteRefusalSchema.strict().safeParse(response).success, reason).toBe(true);
  }
}

/** G3 — no `location_parent_cross_org` is ever produced (A3). */
export function noCrossOrgReasonExists(): void {
  expect(locationWriteRefusalReasonSchema.options).not.toContain("location_parent_cross_org");
}

/** G4 — a trigger refusal maps to the same exception the pre-check throws. */
export function aTriggerRefusalMapsToThePreCheckException(): void {
  for (const reason of ["location_parent_cycle", "location_depth_exceeded", "location_parent_inactive", "location_has_active_children"] as const) {
    const mapped = treeGuardRefusal({ code: "23514", constraint: "locations_tree_guard", message: reason });
    expect(mapped, reason).toBeDefined();
    const expected = refusal(reason);
    expect(mapped?.getStatus(), reason).toBe(expected.getStatus());
    expect(mapped?.constructor, reason).toBe(expected.constructor);
    expect(body(mapped as HttpException), reason).toEqual(body(expected));
  }
}

/** G5 — the mapping reads the driver error through a wrapper's `cause`, and the cause's message. */
export function aWrappedTriggerRefusalIsReadThroughItsCause(): void {
  const wrapped = Object.assign(new Error("Failed query: UPDATE bms.locations …"), {
    cause: { code: "23514", constraint: "locations_tree_guard", message: "location_parent_cycle" },
  });
  const mapped = treeGuardRefusal(wrapped);
  expect(mapped?.getStatus()).toBe(400);
  expect((body(mapped as HttpException) as { reason: string }).reason).toBe("location_parent_cycle");
}

/** G6 — anything else is not the guard's to answer: `undefined`, so the caller rethrows it. */
export function otherErrorsAreNotMapped(): void {
  // Positive control first: the shape that does map.
  expect(treeGuardRefusal({ code: "23514", constraint: "locations_tree_guard", message: "location_parent_cycle" })).toBeDefined();
  expect(treeGuardRefusal({ code: "23505", constraint: "locations_slug_unique", message: "duplicate key" })).toBeUndefined();
  expect(treeGuardRefusal({ code: "23514", constraint: "locations_parent_not_self_check", message: "x" })).toBeUndefined();
  expect(treeGuardRefusal({ code: "23514", constraint: "locations_tree_guard", message: "location_parent_cross_org" })).toBeUndefined();
  expect(treeGuardRefusal({ code: "23514", constraint: "locations_tree_guard", message: "location_inactive" })).toBeUndefined();
  expect(treeGuardRefusal(new Error("boom"))).toBeUndefined();
  expect(treeGuardRefusal(null)).toBeUndefined();
}

/** G7 — the depth check: parent depth + node height over the bound refuses, and an unknown depth fails closed. */
export function depthExceededFailsClosed(): void {
  expect(depthExceeded(7, 1)).toBe(false);
  expect(depthExceeded(1, 7)).toBe(false);
  expect(depthExceeded(8, 1)).toBe(true);
  expect(depthExceeded(4, 5)).toBe(true);
  expect(depthExceeded(Number.NaN, 1)).toBe(true);
  expect(depthExceeded(1, Number.NaN)).toBe(true);
  expect(depthExceeded(null, 1)).toBe(true);
  expect(depthExceeded(undefined, 1)).toBe(true);
}

/** G8 — the advisory key is the one migration 0103's trigger hashes. */
export function theLockKeyMatchesTheTrigger(): void {
  expect(locationTreeLockKey("11111111-1111-4111-8111-111111111111")).toBe(
    "locations_tree:11111111-1111-4111-8111-111111111111",
  );
}
