import { expect } from "vitest";

import { chosenScopeFromFill } from "./dashboard-scope-fill";

/**
 * `F3.85` PR 9 review fix (C3) — `chosenScopeFromFill` reads the kind from the column a Scope fill
 * CHANGED. Assertions live here; `dashboard-scope-fill.test.ts` is the Vitest entry (ADR 0014).
 */

const ORG = "30000000-0000-4000-8000-000000000001";
const LOC = "10000000-0000-4000-8000-000000000001";
const GRP = "20000000-0000-4000-8000-000000000001";

/** A location id over a group scope (the group id still merged in) makes a location scope. */
export function aChangedLocationWinsOverAnUnchangedGroup(): void {
  const next = chosenScopeFromFill(
    { kind: "assetGroup", organizationId: ORG, assetGroupId: GRP },
    { locationId: LOC, assetGroupId: GRP },
  );
  expect(next).toEqual({ kind: "location", organizationId: ORG, locationId: LOC });
}

/** A location fill over an unchosen group (`""`, the clamp's value) makes a location scope. */
export function aLocationFillOverAnUnchosenGroupMakesALocation(): void {
  const next = chosenScopeFromFill(
    { kind: "assetGroup", organizationId: ORG, assetGroupId: "" },
    { locationId: LOC, assetGroupId: "" },
  );
  expect(next).toEqual({ kind: "location", organizationId: ORG, locationId: LOC });
}

/** A group id over a location scope makes a group scope. */
export function aChangedGroupMakesAGroup(): void {
  const next = chosenScopeFromFill(
    { kind: "location", organizationId: ORG, locationId: LOC },
    { locationId: LOC, assetGroupId: GRP },
  );
  expect(next).toEqual({ kind: "assetGroup", organizationId: ORG, assetGroupId: GRP });
}

/** Two nulls over a location scope make the organization-wide scope. */
export function twoNullsMakeTheOrganizationWideScope(): void {
  const next = chosenScopeFromFill(
    { kind: "location", organizationId: ORG, locationId: LOC },
    { locationId: null, assetGroupId: null },
  );
  expect(next).toEqual({ kind: "organization", organizationId: ORG });
}

/** A fill that changes neither column keeps the kind, and takes a filled organization. */
export function anUnchangedFillKeepsTheKind(): void {
  const OTHER_ORG = "30000000-0000-4000-8000-000000000002";
  const next = chosenScopeFromFill(
    { kind: "location", organizationId: ORG, locationId: LOC },
    { organizationId: OTHER_ORG, locationId: LOC, assetGroupId: null },
  );
  expect(next).toEqual({ kind: "location", organizationId: OTHER_ORG, locationId: LOC });
}
