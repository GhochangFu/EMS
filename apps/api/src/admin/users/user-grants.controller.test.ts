import { describe, it } from "vitest";

import * as spec from "./user-grants.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — UserGrantsAdminController (ADR 0089 decision 12)", () => {
  it("the controller carries @UseGuards(JwtAuthGuard)", () => {
    spec.assertGrantsControllerIsBehindJwtAuthGuard();
  });

  it("the routes are GET/POST :id/grants and DELETE :id/grants/:kind/:grantId under admin/users", () => {
    spec.assertGrantsRoutesAreTheThreeOfDecision12();
  });

  it("every handler passes the caller, the ids and the raw body through to the service", async () => {
    await spec.assertGrantsHandlersPassThroughToTheService();
  });

  it("a malformed :id or :grantId is a 400 before the service runs", async () => {
    await spec.assertAMalformedGrantIdIs400();
  });
});
