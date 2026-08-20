import { isAssetLevelReady } from "./hierarchy-filter";

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
