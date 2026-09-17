import { isScopeChosen, scopeColumns, scopeFromDashboard } from "./dashboard-scope";

/**
 * `F3.34` Unit 2 — the pure dashboard-scope model (plan §4.2), one exported function per
 * claim so a mutation reddens exactly one `it()`. `dashboard-scope.test.ts` is the Vitest
 * entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function same(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${message} — expected ${e}, got ${a}`);
}

/**
 * The defect the row fixes (ADR 0047 Amendment 5): an asset-group dashboard used to prefill as
 * "organization" because the prefill was two-way. Mutation: drop the group arm ⇒ red.
 */
export function anAssetGroupDashboardPrefillsAsAssetGroup(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: "g1" }),
    { kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" },
    "a stored row with assetGroupId set must prefill as the assetGroup kind",
  );
}

export function aLocationDashboardPrefillsAsLocation(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: "l1", assetGroupId: null }),
    { kind: "location", organizationId: "org-1", locationId: "l1" },
    "a stored row with locationId set must prefill as the location kind",
  );
}

/** Reddens if the organization fallback is lost (e.g. the arms are reordered and one is dropped). */
export function aScopelessDashboardPrefillsAsOrganization(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: null }),
    { kind: "organization", organizationId: "org-1" },
    "a stored row with neither column set must prefill as organization-wide",
  );
}

/** Mutation: return `true` for the group arm ⇒ red. */
export function anUnchosenAssetGroupIsNotChosen(): void {
  assert(
    !isScopeChosen({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "" }),
    "an assetGroup value with an empty id is not chosen — Save/Create/Duplicate must stay disabled",
  );
}

/** Positive control for the row above. */
export function aChosenAssetGroupIsChosen(): void {
  assert(
    isScopeChosen({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" }),
    "an assetGroup value with an id is chosen",
  );
}

export function theOtherTwoKindsAreChosenByTheirOwnId(): void {
  assert(isScopeChosen({ kind: "organization", organizationId: "org-1" }), "organization with an id is chosen");
  assert(!isScopeChosen({ kind: "organization", organizationId: "" }), "organization without an id is not chosen");
  assert(isScopeChosen({ kind: "location", organizationId: "org-1", locationId: "l1" }), "location with an id is chosen");
  assert(
    !isScopeChosen({ kind: "location", organizationId: "org-1", locationId: "" }),
    "location without an id is not chosen",
  );
}

/** Mutation: return `{ locationId: null, assetGroupId: null }` (the dialog's old body) ⇒ red. */
export function anAssetGroupValueYieldsTheGroupColumn(): void {
  same(
    scopeColumns({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" }),
    { locationId: null, assetGroupId: "g1" },
    "an assetGroup value must carry its id in assetGroupId and null in locationId",
  );
}

/** Positive control for the row above. */
export function aLocationValueYieldsTheLocationColumn(): void {
  same(
    scopeColumns({ kind: "location", organizationId: "org-1", locationId: "l1" }),
    { locationId: "l1", assetGroupId: null },
    "a location value must carry its id in locationId and null in assetGroupId",
  );
}

export function anOrganizationValueYieldsTwoNulls(): void {
  same(
    scopeColumns({ kind: "organization", organizationId: "org-1" }),
    { locationId: null, assetGroupId: null },
    "an organization-wide value must carry two nulls",
  );
}
