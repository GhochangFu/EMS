import { buildFilterOptions, type FilterOptionRows } from "./filter-options.rows";

/**
 * `F4.361` U3 (ADR 0132 decision 2, build note 2, plan D9) — the pure
 * assembly of `GET /filter-options`: what drops out and how `parentId` is
 * masked, with no database. `filter-options.rows.test.ts` is the Vitest entry
 * point (ADR 0014).
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG = "o-listed";
const GONE_ORG = "o-unlisted";

function rows(): FilterOptionRows {
  return {
    organizations: [{ id: ORG, code: "ORG", name: "Listed" }],
    locations: [
      { id: "site", name: "Site", code: "S", parentId: null, organizationId: ORG },
      { id: "child", name: "Child", code: "C", parentId: "site", organizationId: ORG },
      // A node whose parent is not in the answer (the caller's grant starts below it).
      { id: "orphan", name: "Orphan", code: "O", parentId: "unreadable-parent", organizationId: ORG },
      // A location of an organization the answer does not list.
      { id: "foreign-site", name: "Foreign", code: "F", parentId: null, organizationId: GONE_ORG },
      { id: "foreign-child", name: "Foreign child", code: "FC", parentId: "foreign-site", organizationId: GONE_ORG },
    ],
    assetGroups: [
      { id: "g-site", name: "G", code: "G", locationId: "child", organizationId: ORG },
      { id: "g-foreign", name: "GF", code: "GF", locationId: "foreign-site", organizationId: GONE_ORG },
    ],
    members: [
      { assetGroupId: "g-site", assetId: "a-child" },
      { assetGroupId: "g-site", assetId: "a-unlisted" },
      { assetGroupId: "g-foreign", assetId: "a-foreign" },
    ],
    assets: [
      { id: "a-child", code: "A1", name: "Asset", locationId: "child", organizationId: ORG },
      { id: "a-foreign", code: "AF", name: "Foreign asset", locationId: "foreign-site", organizationId: GONE_ORG },
    ],
  };
}

const ids = (items: readonly { id: string }[]): string[] => items.map((item) => item.id);

/** A location of an unlisted organization drops, and so does its child — whose `parentId` never names it. */
export function assertAnUnlistedOrganizationsLocationsDrop(): void {
  const answer = buildFilterOptions(rows());
  assert(JSON.stringify(ids(answer.locations)) === JSON.stringify(["site", "child", "orphan"]), `locations: ${JSON.stringify(ids(answer.locations))}`);
  assert(!JSON.stringify(answer).includes("foreign-site"), "the unlisted organization's location id leaked into the answer");
}

/** A `parentId` that is not a listed location is `null`; a listed one is kept. */
export function assertAnUnlistedParentIsMaskedToNull(): void {
  const answer = buildFilterOptions(rows());
  const byId = new Map(answer.locations.map((location) => [location.id, location]));
  assert(byId.get("orphan")?.parentId === null, `orphan.parentId = ${String(byId.get("orphan")?.parentId)}`);
  assert(byId.get("child")?.parentId === "site", `child.parentId = ${String(byId.get("child")?.parentId)}`);
  // Masked after the last filter: a child whose parent drops with its organization.
  const dropped = buildFilterOptions({
    ...rows(),
    locations: [
      { id: "site", name: "Site", code: "S", parentId: null, organizationId: GONE_ORG },
      { id: "child", name: "Child", code: "C", parentId: "site", organizationId: ORG },
    ],
  });
  assert(dropped.locations[0]?.parentId === null, `a child of a dropped node kept parentId ${String(dropped.locations[0]?.parentId)}`);
}

/** Build note 2: a group's `assetIds` are its members that the answer lists; a group at a dropped location drops. */
export function assertGroupMembersAreListedAssetsOnly(): void {
  const answer = buildFilterOptions(rows());
  assert(JSON.stringify(ids(answer.assetGroups)) === JSON.stringify(["g-site"]), `groups: ${JSON.stringify(ids(answer.assetGroups))}`);
  assert(JSON.stringify(answer.assetGroups[0]?.assetIds) === JSON.stringify(["a-child"]), `members: ${JSON.stringify(answer.assetGroups[0]?.assetIds)}`);
}

/** An asset at a dropped location drops. */
export function assertAnAssetAtADroppedLocationDrops(): void {
  const answer = buildFilterOptions(rows());
  assert(JSON.stringify(ids(answer.assets)) === JSON.stringify(["a-child"]), `assets: ${JSON.stringify(ids(answer.assets))}`);
}

/** An empty input is four empty lists. */
export function assertNothingReadableIsFourEmptyLists(): void {
  const answer = buildFilterOptions({ organizations: [], locations: [], assetGroups: [], members: [], assets: [] });
  assert(
    JSON.stringify(answer) === JSON.stringify({ organizations: [], locations: [], assetGroups: [], assets: [] }),
    `an empty input answered ${JSON.stringify(answer)}`,
  );
}
