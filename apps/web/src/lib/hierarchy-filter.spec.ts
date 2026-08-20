import { isAssetLevelReady, resolveEffectiveOrganizationId } from "./hierarchy-filter";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `HierarchyFilterBar`'s asset dropdown/query used to require an `rtuId`
 * unconditionally, even when `"rtu"` isn't one of the requested levels — a
 * gateway-less asset has no `rtuId` to select, so that left the asset picker
 * permanently unreachable for any screen using
 * `levels={["organization","location","asset"]}` (Manual Entry, F1.8).
 */
export function runIsAssetLevelReadyTests(): void {
  // showRtu: when "rtu" is a requested level, an asset requires its own rtuId.
  assert(
    isAssetLevelReady(true, { locationId: "loc-1", rtuId: "rtu-1" }) === true,
    "with rtu required, a selection carrying both locationId and rtuId must be ready",
  );
  assert(
    isAssetLevelReady(true, { locationId: "loc-1" }) === false,
    "with rtu required, a locationId alone must not be enough",
  );

  // !showRtu: locationId alone must be enough — this is the bug this function fixes.
  assert(
    isAssetLevelReady(false, { locationId: "loc-1" }) === true,
    "without rtu in the requested levels, locationId alone must be ready",
  );
  assert(
    isAssetLevelReady(false, {}) === false,
    "without rtu in the requested levels, no locationId at all must not be ready",
  );
  assert(
    isAssetLevelReady(false, { locationId: "loc-1", rtuId: "rtu-1" }) === true,
    "an rtuId present but not required must not block readiness",
  );
}

/**
 * A locked org's `<select>` is `disabled`, so it never fires `onChange` —
 * `selection.organizationId` stays `undefined` for the lifetime of a scoped
 * user's session. `HierarchyFilterBar` used `selection.organizationId`
 * (rather than this resolved value) to gate and query the location level,
 * so a location/asset-group-scoped user (`wc-admin`, `wc-hvac-admin`) could
 * never populate the location dropdown at all on a blank-start screen like
 * Manual Entry (F1.8), which has no route param to seed `selection` from.
 */
export function runResolveEffectiveOrganizationIdTests(): void {
  assert(
    resolveEffectiveOrganizationId(false, "picked-org", "locked-org") === "picked-org",
    "an explicit selection must win over a locked org",
  );
  assert(
    resolveEffectiveOrganizationId(true, undefined, "locked-org") === "locked-org",
    "a locked org with no explicit selection must resolve to the locked org — this is the bug",
  );
  assert(
    resolveEffectiveOrganizationId(false, undefined, "locked-org") === "",
    "an unlocked org with no explicit selection must resolve to empty, not the locked org",
  );
  assert(
    resolveEffectiveOrganizationId(true, undefined, undefined) === "",
    "a locked org whose id has not loaded yet must resolve to empty",
  );
}
