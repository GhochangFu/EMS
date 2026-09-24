import { describe, it } from "vitest";

import {
  assertAllowedAssetReachesTheGuardOnce,
  assertAllowedAssetReachesTheServiceOnce,
  assertDeniedAssetNeverReachesTheService,
  assertDeniedAssetThrowsForbidden,
  assertListPointsChecksAccessBeforeTheService,
  assertListPointsRefusesWithTheScopeMessage,
  assertNonUuidSegmentNeverReachesTheGuard,
  assertNonUuidSegmentThrowsZodError,
  assertRoleSummaryAssetGroupCallerPassesItsGroups,
  assertRoleSummaryDropsAForeignRequestedId,
  assertRoleSummaryIsDeclaredBeforeAssetPoints,
  assertRoleSummaryLocationCallerPassesItsLocations,
  assertRoleSummaryUnknownKeyIsBadRequest,
  assertRoleSummaryUnknownKeyNeverReachesTheService,
  assertRoleSummaryUnrestrictedReaderPassesNull,
  assertRoleSummaryUnrestrictedReaderPassesNullGroups,
  assertScanFindsTheListHandlerOnReadableAssetIds,
} from "./assets.controller.spec";

/**
 * F3.63 (ADR 0047 Amendment 6 §Q1 point 3) — Vitest entry point for the
 * `GET /assets/:assetId/points` controller checks. Assertions live in the
 * sibling `.spec` (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.63 — assets controller over stubs (the guard, measured)", () => {
  it("listPoints throws ForbiddenException when canReadAsset is false", async () => {
    await assertDeniedAssetThrowsForbidden();
  });

  it("listPoints never calls the service when canReadAsset is false", async () => {
    await assertDeniedAssetNeverReachesTheService();
  });

  it("listPoints calls the service once with the parsed id when allowed (positive control)", async () => {
    await assertAllowedAssetReachesTheServiceOnce();
  });

  it("listPoints reaches canReadAsset once with the parsed id when allowed (positive control)", async () => {
    await assertAllowedAssetReachesTheGuardOnce();
  });

  it("a non-uuid segment throws ZodError", async () => {
    await assertNonUuidSegmentThrowsZodError();
  });

  it("a non-uuid segment never reaches canReadAsset", async () => {
    await assertNonUuidSegmentNeverReachesTheGuard();
  });
});

describe("F3.63 — assets controller source scan", () => {
  it("listPoints checks canReadAsset before calling the service", () => {
    assertListPointsChecksAccessBeforeTheService();
  });

  it("listPoints refuses with the asset-health 403 message", () => {
    assertListPointsRefusesWithTheScopeMessage();
  });

  it("list still narrows through readableAssetIds and listPoints does not (positive control)", () => {
    assertScanFindsTheListHandlerOnReadableAssetIds();
  });
});

describe("F3.28 — GET /assets/role-summary over stubs (ADR 0074, plan task 3.2)", () => {
  it("drops a requested id outside the readable set before the service", async () => {
    await assertRoleSummaryDropsAForeignRequestedId();
  });

  it("passes null for an unrestricted reader with no request (positive control)", async () => {
    await assertRoleSummaryUnrestrictedReaderPassesNull();
  });

  it("an asset-group caller passes its granted group ids", async () => {
    await assertRoleSummaryAssetGroupCallerPassesItsGroups();
  });

  it("a location-scoped caller passes its readable location ids, not an empty group list", async () => {
    await assertRoleSummaryLocationCallerPassesItsLocations();
  });

  it("an unrestricted reader passes null groups without resolving currentUser", async () => {
    await assertRoleSummaryUnrestrictedReaderPassesNullGroups();
  });

  it("answers an unknown query key with BadRequestException", async () => {
    await assertRoleSummaryUnknownKeyIsBadRequest();
  });

  it("never calls the service for an unknown query key", async () => {
    await assertRoleSummaryUnknownKeyNeverReachesTheService();
  });

  it("declares role-summary before :assetId/points", () => {
    assertRoleSummaryIsDeclaredBeforeAssetPoints();
  });
});
