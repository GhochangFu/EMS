import { describe, it } from "vitest";

import {
  assertADeletedAssetLeavesOnThePeriodicReload,
  assertAFailedFirstLoadFailsOpen,
  assertANewAssetIsForwardedAfterOneReload,
  assertAnUnknownIdReloadsAtMostOncePerInterval,
  assertDropsAnOrphanReadingOnceLoaded,
  assertForwardsAnExistingAssetsReading,
  assertForwardsEverythingBeforeTheFirstLoad,
  assertOneLoadAtATime,
  assertTheGatewayFiltersBeforeItEmits,
} from "./existing-asset-ids.spec";

/**
 * `F4.159` post-merge review — Vitest wrapper for the socket filter on readings
 * of an asset id with no `bms.assets` row. Assertions live in the sibling
 * `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.159 — the live socket drops readings of an asset id with no bms.assets row", () => {
  it("forwards every reading before the first load completes", assertForwardsEverythingBeforeTheFirstLoad);

  it("drops an orphan reading once the set has loaded", assertDropsAnOrphanReadingOnceLoaded);

  it("forwards an existing asset's reading", assertForwardsAnExistingAssetsReading);

  it("forwards a new asset after one reload", assertANewAssetIsForwardedAfterOneReload);

  it("reloads on an unknown id at most once per interval", assertAnUnknownIdReloadsAtMostOncePerInterval);

  it("drops a deleted asset after the periodic reload", assertADeletedAssetLeavesOnThePeriodicReload);

  it("fails open when the first load fails", assertAFailedFirstLoadFailsOpen);

  it("runs one load at a time", assertOneLoadAtATime);

  it("gateway: a global socket gets the filtered batch", assertTheGatewayFiltersBeforeItEmits);
});
