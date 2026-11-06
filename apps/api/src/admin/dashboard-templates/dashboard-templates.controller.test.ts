import { describe, it } from "vitest";

import {
  assertApplyToSitesCallsTheBulk,
  assertApplyToSitesRefusesABadId,
  assertApplyToSitesRouteIsDeclared,
  assertEachInstantiateBodyReachesItsArm,
  runDashboardTemplatesControllerTests,
} from "./dashboard-templates.controller.spec";

/** `F3.36` Part E3 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). */
describe("F3.36 — dashboard template controller route order", () => {
  it("declares the literal /stock route before the parameterised /:id route", () => {
    runDashboardTemplatesControllerTests();
  });
});

/** `F3.73` plan Task 4.2 — the bulk backfill route. */
describe("F3.73 — POST /admin/dashboard-templates/:id/apply-to-sites", () => {
  it("declares the route on applyToSites", () => {
    assertApplyToSitesRouteIsDeclared();
  });

  it("passes the path id to makeForOrganization with the caller", async () => {
    await assertApplyToSitesCallsTheBulk();
  });

  it("refuses a non-uuid id before the bulk runs", async () => {
    await assertApplyToSitesRefusesABadId();
  });
});

/** `F4.317` review — the instantiate route's arm picker. */
describe("F4.317 — POST /admin/dashboard-templates/:id/instantiate", () => {
  it("routes the organization, site and group bodies each to its own service method", async () => {
    await assertEachInstantiateBodyReachesItsArm();
  });
});
