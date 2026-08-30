import { describe, it } from "vitest";

import {
  assertADeniedAssetNeverReachesTheService,
  assertAMalformedForAssetQueryIsABadRequest,
  assertAMalformedSummaryQueryIsABadRequestBeforeAccessControl,
  assertAnUnrestrictedScopeStaysNull,
  assertLocationIdIsPassedThroughOrUndefined,
  assertTheReadableScopeFlowsThroughByReference,
} from "./asset-health.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-health.controller", () => {
  it("refuses a denied asset before the service is ever called", async () => {
    await assertADeniedAssetNeverReachesTheService();
  });

  it("passes the exact readableAssetIds() array through to summary(), not a copy", async () => {
    await assertTheReadableScopeFlowsThroughByReference();
  });

  it("keeps an unrestricted admin's null scope as null, not undefined or []", async () => {
    await assertAnUnrestrictedScopeStaysNull();
  });

  it("answers a malformed forAsset query with 400 and never calls the service", async () => {
    await assertAMalformedForAssetQueryIsABadRequest();
  });

  it("answers a malformed summary query with 400 before readableAssetIds runs", async () => {
    await assertAMalformedSummaryQueryIsABadRequestBeforeAccessControl();
  });

  it("passes locationId through when valid, and undefined when absent", async () => {
    await assertLocationIdIsPassedThroughOrUndefined();
  });
});
