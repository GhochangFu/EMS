import { expect } from "vitest";

import { restrictScope } from "./audit.read-scope";

/**
 * `F4.277` — the organization restriction a service-internal caller (the
 * copilot's `list_audit_log`) puts on an audit read. The restriction only ever
 * narrows the caller's own scope; one exported assertion per case so the
 * sibling `.test.ts` registers one `it()` each (a later case cannot hide
 * behind an earlier throw).
 */

const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const ORG_C = "00000000-0000-4000-8000-0000000000cc";

/** No restriction on the global admin's `null`: every organization, as the route reads. */
export function assertNoRestrictionKeepsTheUnfilteredScope(): void {
  expect(restrictScope(null, undefined)).toBeNull();
}

/** No restriction on a scoped reader: its own scope, unchanged. */
export function assertNoRestrictionKeepsTheScopedReader(): void {
  expect(restrictScope([ORG_A, ORG_B], undefined)).toEqual([ORG_A, ORG_B]);
}

/** A restriction on the global admin's `null`: exactly the restricted organizations. */
export function assertARestrictionNarrowsTheUnfilteredScope(): void {
  expect(restrictScope(null, [ORG_A])).toEqual([ORG_A]);
}

/** A restriction on a scoped reader: the intersection, never an organization outside its own scope. */
export function assertARestrictionIntersectsTheScopedReader(): void {
  expect(restrictScope([ORG_A, ORG_B], [ORG_B, ORG_C])).toEqual([ORG_B]);
}

/** A disjoint or empty restriction is `[]` (matches nothing, §4.7), never `null`. */
export function assertAnEmptyIntersectionFailsClosed(): void {
  expect(restrictScope([ORG_A], [ORG_C])).toEqual([]);
  expect(restrictScope(null, [])).toEqual([]);
}
