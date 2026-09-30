import { describe, it } from "vitest";

import {
  listForwardsTheLocationIdQueryToTheService,
  listForwardsTheSectionQueryToTheService,
  listRefusesAMalformedLocationIdWith400,
  putWidgetsRefusesAnUppercaseLayoutIdWith400,
  runDashboardBuilderControllerTests,
  siteWidgetsForwardsTheTabToTheService,
  siteWidgetsRefusesAMalformedQueryWith400,
  siteWidgetsRouteIsDeclaredBeforeSlug,
} from "./dashboard-builder.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1b — DashboardBuilderController (stubbed service)", () => {
  it("gates every mutating route before the service, and parses each body against its schema", async () => {
    await runDashboardBuilderControllerTests();
  });

  it("forwards ?section= to the service (E4.2)", async () => {
    await listForwardsTheSectionQueryToTheService();
  });

  it("forwards ?locationId= to the service as the fifth argument (F3.72)", async () => {
    await listForwardsTheLocationIdQueryToTheService();
  });

  it("refuses a malformed ?locationId= with 400 before the service (F3.72)", async () => {
    await listRefusesAMalformedLocationIdWith400();
  });

  it("refuses an uppercase mimic layoutId with 400 before the service (F3.32c)", async () => {
    await putWidgetsRefusesAnUppercaseLayoutIdWith400();
  });

  it("declares GET :id/site-widgets before :slug (F3.73)", () => {
    siteWidgetsRouteIsDeclaredBeforeSlug();
  });

  it("forwards ?tab= to the site-widgets service, and an absent one as undefined (F3.73)", async () => {
    await siteWidgetsForwardsTheTabToTheService();
  });

  it("refuses a malformed site-widgets request with 400 before the service (F3.73)", async () => {
    await siteWidgetsRefusesAMalformedQueryWith400();
  });
});
