import { describe, it } from "vitest";

import {
  aBadQueryIsRefusedBeforeAccessControl,
  theInputsRouteChecksTheIdThenTheAsset,
  theLocationCarriesTheCallersReadableSets,
  theOrganizationNarrowsThroughTheIntersection,
  theReadableSetReachesTheServiceUnchanged,
} from "./health-inputs.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — HealthInputsController (ADR 0050 Amendment 5)", () => {
  it("inputs: a non-UUID id is 400 before canReadAsset; a denied asset is 403 before the service", () =>
    theInputsRouteChecksTheIdThenTheAsset());
  it("bad-actors: a bad query is 400 before any access-control read", () => aBadQueryIsRefusedBeforeAccessControl());
  it("bad-actors: readableAssetIds' value (an array, [], null) reaches the service unchanged", () =>
    theReadableSetReachesTheServiceUnchanged());
  it("bad-actors: organizationId narrows through readableAssetIdsInOrganization", () =>
    theOrganizationNarrowsThroughTheIntersection());
  it("bad-actors: locationId carries the caller's readable locations and organizations", () =>
    theLocationCarriesTheCallersReadableSets());
});
