import {
  isScopeAuthorised,
  isScopeChosen,
  isScopeOffered,
  scopeAssetGroupOptions,
  scopeChanged,
  scopeColumns,
  scopeForDuplicate,
  scopeFromDashboard,
  scopePatch,
} from "./dashboard-scope";
import type { AccessibleScope } from "@bms/shared";

/**
 * `F3.34` Unit 2 — the pure dashboard-scope model (plan §4.2), one exported function per
 * claim so a mutation reddens exactly one `it()`. `dashboard-scope.test.ts` is the Vitest
 * entry point (ADR 0014). `F3.63` Unit 3 (ADR 0047 Amendment 6) added the read-only `asset`
 * kind and its four new functions, plus `scopeAssetGroupOptions`.
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
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: "g1", assetId: null }),
    { kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" },
    "a stored row with assetGroupId set must prefill as the assetGroup kind",
  );
}

/** The location arm, unchanged by the row. With the case below it pins the arm ORDER: a row
 * with a location prefills as location whatever the group column says. */
export function aLocationDashboardPrefillsAsLocation(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: "l1", assetGroupId: null, assetId: null }),
    { kind: "location", organizationId: "org-1", locationId: "l1" },
    "a stored row with locationId set must prefill as the location kind",
  );
}

/** Reddens if the organization fallback is lost (e.g. the arms are reordered and one is dropped). */
export function aScopelessDashboardPrefillsAsOrganization(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: null, assetId: null }),
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

/** The organization kind is chosen by its own id — the pre-`F3.34` rule, kept. One claim per
 * function: `assert` throws, so a second claim in the same body would never redden. */
export function aChosenOrganizationIsChosen(): void {
  assert(isScopeChosen({ kind: "organization", organizationId: "org-1" }), "organization with an id is chosen");
}

/** Mutation: return `true` for the organization arm ⇒ red. */
export function anUnchosenOrganizationIsNotChosen(): void {
  assert(!isScopeChosen({ kind: "organization", organizationId: "" }), "organization without an id is not chosen");
}

/** The location kind is chosen by its own id, never by `organizationId` alone. */
export function aChosenLocationIsChosen(): void {
  assert(isScopeChosen({ kind: "location", organizationId: "org-1", locationId: "l1" }), "location with an id is chosen");
}

/** Mutation: read `organizationId` for the location arm ⇒ red (the id is set, the location is not). */
export function anUnchosenLocationIsNotChosen(): void {
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

/** The organization-wide body is two explicit nulls — the create page now sends them rather
 * than omitting `locationId`; both spellings are legal to `dashboards.schema.ts`. */
export function anOrganizationValueYieldsTwoNulls(): void {
  same(
    scopeColumns({ kind: "organization", organizationId: "org-1" }),
    { locationId: null, assetGroupId: null },
    "an organization-wide value must carry two nulls",
  );
}

/**
 * `F3.63` Unit 3 (ADR 0047 Amendment 6 §Q2) — the defect the row fixes: an asset-scoped stored
 * row used to prefill as "organization" because the prefill was three-way and never read
 * `assetId`. Mutation: keep the three-way switch ⇒ `organization` ⇒ red.
 */
export function anAssetScopedDashboardPrefillsAsAsset(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: null, assetId: "a1" }),
    { kind: "asset", organizationId: "org-1", assetId: "a1" },
    "a stored row with assetId set must prefill as the asset kind",
  );
}

/** With the case above, pins that dropping the fallback (rather than just missing the new arm)
 * still reddens on its own — a scopeless, asset-less row is still organization-wide. */
export function aScopelessAssetlessDashboardStillPrefillsAsOrganization(): void {
  same(
    scopeFromDashboard({ organizationId: "org-1", locationId: null, assetGroupId: null, assetId: null }),
    { kind: "organization", organizationId: "org-1" },
    "a stored row with no assetId and no scope column must still prefill as organization-wide",
  );
}

/** `F3.63` (Amendment 6 §Q2, last sentence) — duplicating an asset-scoped dashboard still
 * prefills as its organization, now an explicit fold rather than an accident of a three-way
 * prefill. The dto here carries `assetId` at runtime, as the dialog's real source dto does — the
 * function's parameter type just does not declare it. Mutation: pass the asset arm through (e.g.
 * by widening the dto type to read `assetId`) ⇒ red. */
export function duplicatingAnAssetScopedDashboardFoldsToOrganization(): void {
  const source = { organizationId: "org-1", locationId: null, assetGroupId: null, assetId: "a1" };
  same(
    scopeForDuplicate(source),
    { kind: "organization", organizationId: "org-1" },
    "duplicating an asset-scoped source must fold to organization-wide",
  );
}

/** Positive control for the row above: a group-scoped source duplicates as its own group. */
export function duplicatingAnAssetGroupScopedDashboardKeepsItsGroup(): void {
  same(
    scopeForDuplicate({ organizationId: "org-1", locationId: null, assetGroupId: "g1" }),
    { kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" },
    "duplicating a group-scoped source must keep the group kind",
  );
}

/** Mutation: return `false` unconditionally for the `asset` arm ⇒ red. */
export function aChosenAssetIsChosen(): void {
  assert(
    isScopeChosen({ kind: "asset", organizationId: "org-1", assetId: "a1" }),
    "an asset value with an id is chosen",
  );
}

/** Mutation: return `true` unconditionally for the `asset` arm ⇒ red. */
export function anUnchosenAssetIsNotChosen(): void {
  assert(
    !isScopeChosen({ kind: "asset", organizationId: "org-1", assetId: "" }),
    "an asset value with an empty id is not chosen",
  );
}

/** `F3.63` (Amendment 6 §Q2) — the edit page's PATCH omits both scope columns for an
 * asset-scoped row. Mutation: return `{ locationId: null, assetGroupId: null }` ⇒ the `same`
 * check reds; return `{ locationId: undefined, assetGroupId: undefined }` ⇒ this function's own
 * `Object.keys` assertion reds (an own property set to `undefined` is not an absent key). */
export function anAssetValuePatchesToNoKeys(): void {
  const patch = scopePatch({ kind: "asset", organizationId: "org-1", assetId: "a1" });
  same(patch, {}, "an asset value must patch to an empty object");
  assert(Object.keys(patch).length === 0, `an asset value's patch must have no keys — got ${Object.keys(patch)}`);
}

/** Positive control for the row above: a chosen kind still patches to its two columns. */
export function aGroupValuePatchesToItsColumn(): void {
  same(
    scopePatch({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "g1" }),
    { locationId: null, assetGroupId: "g1" },
    "a group value must patch to its own columns, unchanged from scopeColumns",
  );
}

/** `F3.63` — an asset-scoped value is never dirty; the form that renders it cannot edit its
 * scope. Mutation: compare the (nonexistent) columns for the asset arm ⇒ red. */
export function anAssetValueIsNeverChanged(): void {
  assert(
    !scopeChanged({ kind: "asset", organizationId: "org-1", assetId: "a1" }, { locationId: null, assetGroupId: null }),
    "an asset value must never read as changed",
  );
}

/** Positive control: a location value that differs from the stored column IS changed. */
export function aDifferentLocationValueIsChanged(): void {
  assert(
    scopeChanged(
      { kind: "location", organizationId: "org-1", locationId: "l2" },
      { locationId: "l1", assetGroupId: null },
    ),
    "a location value that differs from the stored column must read as changed",
  );
}

/** Positive control: a group value that differs from the stored column IS changed. */
export function aDifferentAssetGroupValueIsChanged(): void {
  assert(
    scopeChanged(
      { kind: "assetGroup", organizationId: "org-1", assetGroupId: "g2" },
      { locationId: null, assetGroupId: "g1" },
    ),
    "a group value that differs from the stored column must read as changed",
  );
}

const SCOPE_FIXTURE: AccessibleScope = {
  kind: "asset_group",
  locations: [
    { id: "loc-1", code: "WC", slug: "western-cape", name: "Western Cape", type: "smoc_campus", province: null },
  ],
  assetGroups: [
    { id: "grp-1", locationId: "loc-1", code: "hvac", name: "Hvac", organizationId: "org-1" },
    { id: "grp-2", locationId: "loc-missing", code: "elec", name: "Electrical", organizationId: "org-1" },
    { id: "grp-3", locationId: "loc-1", code: "water", name: "Water", organizationId: "org-2" },
  ],
  assetIds: [],
};

/** `F3.63` — `scopeAssetGroupOptions` maps `{id, name, organizationId}` and resolves
 * `locationName` from `scope.locations` by `locationId`. Mutation: derive `locationName` from
 * `code` instead of the joined location's `name` ⇒ red. */
export function scopeAssetGroupOptionsMapsTheGroupAndItsLocationName(): void {
  const options = scopeAssetGroupOptions(SCOPE_FIXTURE);
  const grp1 = options.find((option) => option.id === "grp-1");
  same(
    grp1,
    { id: "grp-1", name: "Hvac", organizationId: "org-1", locationName: "Western Cape" },
    "grp-1 must map to its own fields with the joined location's name",
  );
}

/** A group whose `locationId` is absent from `scope.locations` maps to `locationName: null`. */
export function scopeAssetGroupOptionsNullsAMissingLocation(): void {
  const options = scopeAssetGroupOptions(SCOPE_FIXTURE);
  const grp2 = options.find((option) => option.id === "grp-2");
  assert(grp2 !== undefined && grp2.locationName === null, "grp-2's locationName must be null, not undefined or a code");
}

/** Mutation: drop the `organizationId` filter ⇒ red (grp-3, a different organization, leaks in). */
export function scopeAssetGroupOptionsFiltersByOrganization(): void {
  const options = scopeAssetGroupOptions(SCOPE_FIXTURE, "org-1");
  same(
    options.map((option) => option.id).sort(),
    ["grp-1", "grp-2"],
    "the organizationId filter must keep only that organization's groups",
  );
}

// ---------------------------------------------------------------------------
// isScopeOffered (`F3.63` review — a foreign scope must not enable Save)
// ---------------------------------------------------------------------------

const OFFERED = { locations: [{ id: "loc-1" }], assetGroups: [{ id: "grp-1" }] };

/** Mutation: return `false` for the `organization` arm ⇒ red. */
export function anOrganizationValueIsAlwaysOffered(): void {
  assert(
    isScopeOffered({ kind: "organization", organizationId: "org-1" }, { locations: [], assetGroups: [] }),
    "an organization value is offered whatever the lists hold",
  );
}

/** Mutation: return `false` for the `asset` arm ⇒ red. */
export function anAssetValueIsAlwaysOffered(): void {
  assert(
    isScopeOffered({ kind: "asset", organizationId: "org-1", assetId: "a1" }, { locations: [], assetGroups: [] }),
    "an asset value is offered whatever the lists hold",
  );
}

/** Mutation: check `assetGroups` on the location arm ⇒ red. */
export function aLocationInTheOfferedListIsOffered(): void {
  assert(
    isScopeOffered({ kind: "location", organizationId: "org-1", locationId: "loc-1" }, OFFERED),
    "a location present in the offered list is offered",
  );
}

/** The defect (review): a `location_admin` opening a dashboard on a location it does not hold.
 * Mutation: return `true` for the location arm ⇒ red. */
export function aLocationAbsentFromTheOfferedListIsNotOffered(): void {
  assert(
    !isScopeOffered({ kind: "location", organizationId: "org-1", locationId: "loc-9" }, OFFERED),
    "a location absent from the offered list is not offered",
  );
}

/** Mutation: check `locations` on the group arm ⇒ red. */
export function anAssetGroupInTheOfferedListIsOffered(): void {
  assert(
    isScopeOffered({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-1" }, OFFERED),
    "a group present in the offered list is offered",
  );
}

/** The defect (review): an `asset_group_admin` opening a dashboard on a group it does not hold.
 * Mutation: return `true` for the group arm ⇒ red. */
export function anAssetGroupAbsentFromTheOfferedListIsNotOffered(): void {
  assert(
    !isScopeOffered({ kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-9" }, OFFERED),
    "a group absent from the offered list is not offered",
  );
}

// ---------------------------------------------------------------------------
// isScopeAuthorised (`F3.63` post-merge sweep — the list is the SCOPED roles' authority only)
// ---------------------------------------------------------------------------

const FOREIGN_LOCATION = { kind: "location", organizationId: "org-1", locationId: "loc-9" } as const;
const FOREIGN_GROUP = { kind: "assetGroup", organizationId: "org-1", assetGroupId: "grp-9" } as const;

/** The regression the sweep fixes: an `admin` on a dashboard whose location is absent from the
 * active-only list (set inactive after the dashboard was scoped to it). Mutation: drop `admin`
 * from the picker-roles constant ⇒ red. */
export function adminIsAuthorisedForALocationAbsentFromTheList(): void {
  assert(isScopeAuthorised("admin", FOREIGN_LOCATION, OFFERED), "admin is authorised whatever the location list holds");
}

/** Mutation: drop `organization_admin` from the picker-roles constant ⇒ red. */
export function organizationAdminIsAuthorisedForAGroupAbsentFromTheList(): void {
  assert(
    isScopeAuthorised("organization_admin", FOREIGN_GROUP, OFFERED),
    "organization_admin is authorised whatever the group list holds",
  );
}

/** Mutation: add `location_admin` to the picker-roles constant, or return `true` ⇒ red. */
export function locationAdminIsNotAuthorisedForALocationAbsentFromTheList(): void {
  assert(
    !isScopeAuthorised("location_admin", FOREIGN_LOCATION, OFFERED),
    "location_admin is not authorised for a location its list does not hold",
  );
}

/** The positive control beside the refusal above: the scoped arm defers to `isScopeOffered`,
 * so an offered location IS authorised. Mutation: return `false` on the scoped arm ⇒ red. */
export function locationAdminIsAuthorisedForAnOfferedLocation(): void {
  assert(
    isScopeAuthorised("location_admin", { kind: "location", organizationId: "org-1", locationId: "loc-1" }, OFFERED),
    "location_admin is authorised for a location its list holds",
  );
}

/** Mutation: add `asset_group_admin` to the picker-roles constant, or return `true` ⇒ red. */
export function assetGroupAdminIsNotAuthorisedForAGroupAbsentFromTheList(): void {
  assert(
    !isScopeAuthorised("asset_group_admin", FOREIGN_GROUP, OFFERED),
    "asset_group_admin is not authorised for a group its list does not hold",
  );
}
