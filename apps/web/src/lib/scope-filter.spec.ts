import { expect } from "vitest";

import type { FilterOptionsResponse } from "@bms/shared/contracts";

import {
  applyScopeChange,
  readScopeFilter,
  reconcileScopeFilter,
  scopeFilterChoices,
  writeScopeFilter,
} from "./scope-filter";

/**
 * `F4.361` U6 (ADR 0132 decisions 6 and 8, plan D10–D12) — the pure cascade behind the scope
 * pickers on `/alarms` and `/rules`. `scope-filter.test.ts` is the Vitest entry point.
 *
 * The fixture is two organizations. ORG_A holds the tree `SITE_A – SITE_A1` and `SITE_B`; group
 * G_A1 sits at SITE_A1 with asset AS_A1 as its member; asset AS_A1X is at SITE_A1 but in no
 * group; asset AS_B at SITE_B. ORG_X holds SITE_X and asset AS_X.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_X = "aaaaaaaa-0000-4000-8000-000000000002";
const SITE_A = "bbbbbbbb-0000-4000-8000-000000000001";
const SITE_A1 = "bbbbbbbb-0000-4000-8000-000000000002";
const SITE_B = "bbbbbbbb-0000-4000-8000-000000000003";
const SITE_X = "bbbbbbbb-0000-4000-8000-000000000004";
const G_A1 = "cccccccc-0000-4000-8000-000000000001";
const G_B = "cccccccc-0000-4000-8000-000000000002";
const AS_A1 = "dddddddd-0000-4000-8000-000000000001";
const AS_A1X = "dddddddd-0000-4000-8000-000000000002";
const AS_B = "dddddddd-0000-4000-8000-000000000003";
const AS_X = "dddddddd-0000-4000-8000-000000000004";
const UNKNOWN = "eeeeeeee-0000-4000-8000-000000000009";

export const OPTIONS: FilterOptionsResponse = {
  organizations: [
    { id: ORG_A, code: "ORGA", name: "Org A" },
    { id: ORG_X, code: "ORGX", name: "Org X" },
  ],
  locations: [
    { id: SITE_A, name: "Site A", code: "SA", parentId: null, organizationId: ORG_A },
    { id: SITE_A1, name: "Site A1", code: "SA1", parentId: SITE_A, organizationId: ORG_A },
    { id: SITE_B, name: "Site B", code: "SB", parentId: null, organizationId: ORG_A },
    { id: SITE_X, name: "Site X", code: "SX", parentId: null, organizationId: ORG_X },
  ],
  assetGroups: [
    { id: G_A1, name: "Group A1", code: "GA1", locationId: SITE_A1, organizationId: ORG_A, assetIds: [AS_A1] },
    { id: G_B, name: "Group B", code: "GB", locationId: SITE_B, organizationId: ORG_A, assetIds: [AS_B] },
  ],
  assets: [
    { id: AS_A1, code: "A1-01", name: "Asset A1", locationId: SITE_A1, organizationId: ORG_A },
    { id: AS_A1X, code: "A1-02", name: "Asset A1 loose", locationId: SITE_A1, organizationId: ORG_A },
    { id: AS_B, code: "B-01", name: "Asset B", locationId: SITE_B, organizationId: ORG_A },
    { id: AS_X, code: "X-01", name: "Asset X", locationId: SITE_X, organizationId: ORG_X },
  ],
};

/** One organization only: the same answer cut to ORG_X. */
export const ONE_ORG: FilterOptionsResponse = {
  organizations: [OPTIONS.organizations[1]],
  locations: OPTIONS.locations.filter((l) => l.organizationId === ORG_X),
  assetGroups: [],
  assets: OPTIONS.assets.filter((a) => a.organizationId === ORG_X),
};

export const IDS = { ORG_A, ORG_X, SITE_A, SITE_A1, SITE_B, SITE_X, G_A1, G_B, AS_A1, AS_A1X, AS_B, AS_X, UNKNOWN };

/** The URL is read key by key: empty is absent, other parameters are ignored, ids are lower-cased. */
export function readsTheFourKeysOnly(): void {
  const params = new URLSearchParams(`organizationId=${ORG_A.toUpperCase()}&locationId=&severity=critical&assetId=${AS_A1}`);
  expect(readScopeFilter(params)).toEqual({ organizationId: ORG_A, assetId: AS_A1 });
}

/** Writing replaces the four keys and keeps every other parameter. */
export function writeKeepsOtherParameters(): void {
  const params = new URLSearchParams(`severity=critical&locationId=${SITE_B}&assetId=${AS_B}`);
  const next = writeScopeFilter(params, { organizationId: ORG_A, locationId: SITE_A });
  expect(next.get("severity")).toBe("critical");
  expect(next.get("organizationId")).toBe(ORG_A);
  expect(next.get("locationId")).toBe(SITE_A);
  expect(next.has("assetId")).toBe(false);
  // The input is not mutated.
  expect(params.get("locationId")).toBe(SITE_B);
}

/** A location of another organization is dropped; the organization stays. */
export function aCrossOrganizationLocationIsDropped(): void {
  expect(reconcileScopeFilter({ organizationId: ORG_A, locationId: SITE_X }, OPTIONS)).toEqual({ organizationId: ORG_A });
}

/** A group outside the chosen location's subtree is dropped; one inside it stays. */
export function aGroupOutsideTheSubtreeIsDropped(): void {
  expect(reconcileScopeFilter({ organizationId: ORG_A, locationId: SITE_A, assetGroupId: G_B }, OPTIONS)).toEqual({
    organizationId: ORG_A,
    locationId: SITE_A,
  });
  expect(reconcileScopeFilter({ organizationId: ORG_A, locationId: SITE_A, assetGroupId: G_A1 }, OPTIONS)).toEqual({
    organizationId: ORG_A,
    locationId: SITE_A,
    assetGroupId: G_A1,
  });
}

/** An asset that is not a member of the chosen group is dropped, even at the group's own site. */
export function anAssetOutsideTheGroupIsDropped(): void {
  expect(reconcileScopeFilter({ organizationId: ORG_A, assetGroupId: G_A1, assetId: AS_A1X }, OPTIONS)).toEqual({
    organizationId: ORG_A,
    assetGroupId: G_A1,
  });
  expect(reconcileScopeFilter({ organizationId: ORG_A, assetGroupId: G_A1, assetId: AS_A1 }, OPTIONS)).toEqual({
    organizationId: ORG_A,
    assetGroupId: G_A1,
    assetId: AS_A1,
  });
}

/** An asset outside the chosen location's subtree is dropped. */
export function anAssetOutsideTheSubtreeIsDropped(): void {
  expect(reconcileScopeFilter({ organizationId: ORG_A, locationId: SITE_A, assetId: AS_B }, OPTIONS)).toEqual({
    organizationId: ORG_A,
    locationId: SITE_A,
  });
}

/** An id the options do not list is dropped at every level. */
export function anUnknownIdIsDropped(): void {
  expect(reconcileScopeFilter({ organizationId: UNKNOWN }, OPTIONS)).toEqual({});
  expect(
    reconcileScopeFilter({ organizationId: ORG_A, locationId: UNKNOWN, assetGroupId: UNKNOWN, assetId: UNKNOWN }, OPTIONS),
  ).toEqual({ organizationId: ORG_A });
}

/** A child named without its organization gets the organization filled in (D10). */
export function aChildFillsItsOrganization(): void {
  expect(reconcileScopeFilter({ locationId: SITE_X }, OPTIONS)).toEqual({ organizationId: ORG_X, locationId: SITE_X });
  expect(reconcileScopeFilter({ assetId: AS_B }, OPTIONS)).toEqual({ organizationId: ORG_A, assetId: AS_B });
}

/** With one organization it is never written or sent (D11), and its children still validate. */
export function aLockedOrganizationIsNotWritten(): void {
  expect(reconcileScopeFilter({ organizationId: ORG_X, locationId: SITE_X }, ONE_ORG)).toEqual({ locationId: SITE_X });
  expect(reconcileScopeFilter({ locationId: SITE_A }, ONE_ORG)).toEqual({});
  const choices = scopeFilterChoices({}, ONE_ORG);
  expect(choices.organizationLocked).toBe(true);
  expect(choices.organizationId).toBe(ORG_X);
  expect(choices.locations.map((l) => l.id)).toEqual([SITE_X]);
}

/** Changing the organization clears every child (D10, decision 6). */
export function anOrganizationChangeClearsTheChildren(): void {
  const from = { organizationId: ORG_A, locationId: SITE_A, assetGroupId: G_A1, assetId: AS_A1 };
  expect(applyScopeChange(from, "organizationId", ORG_X, OPTIONS)).toEqual({ organizationId: ORG_X });
  expect(applyScopeChange(from, "organizationId", "", OPTIONS)).toEqual({});
}

/** Changing the location clears the group and asset it no longer contains, and keeps one it does. */
export function aLocationChangeClearsWhatItNoLongerContains(): void {
  const from = { organizationId: ORG_A, assetGroupId: G_A1, assetId: AS_A1 };
  expect(applyScopeChange(from, "locationId", SITE_B, OPTIONS)).toEqual({ organizationId: ORG_A, locationId: SITE_B });
  expect(applyScopeChange(from, "locationId", SITE_A, OPTIONS)).toEqual({ ...from, locationId: SITE_A });
}

/** Choosing a group drops an asset outside it; "All" on a level clears only that level. */
export function aGroupChangeNarrowsTheAsset(): void {
  const from = { organizationId: ORG_A, assetId: AS_A1X };
  expect(applyScopeChange(from, "assetGroupId", G_A1, OPTIONS)).toEqual({ organizationId: ORG_A, assetGroupId: G_A1 });
  expect(applyScopeChange({ organizationId: ORG_A, locationId: SITE_A, assetId: AS_A1 }, "locationId", "", OPTIONS)).toEqual({
    organizationId: ORG_A,
    assetId: AS_A1,
  });
}

/** The choices cascade: Organization gates, Location narrows groups and assets, a group narrows assets. */
export function theChoicesCascade(): void {
  const none = scopeFilterChoices({}, OPTIONS);
  expect(none.organizationLocked).toBe(false);
  expect(none.organizationId).toBe("");
  expect([none.locations, none.assetGroups, none.assets]).toEqual([[], [], []]);

  const org = scopeFilterChoices({ organizationId: ORG_A }, OPTIONS);
  expect(org.locations.map((l) => l.label)).toEqual(["Site A", "— Site A1", "Site B"]);
  expect(org.assets.map((a) => a.id)).toEqual([AS_A1, AS_A1X, AS_B]);

  const site = scopeFilterChoices({ organizationId: ORG_A, locationId: SITE_A }, OPTIONS);
  expect(site.assetGroups.map((g) => g.id)).toEqual([G_A1]);
  expect(site.assets.map((a) => a.id)).toEqual([AS_A1, AS_A1X]);

  const group = scopeFilterChoices({ organizationId: ORG_A, assetGroupId: G_A1 }, OPTIONS);
  expect(group.assets.map((a) => a.id)).toEqual([AS_A1]);
}
