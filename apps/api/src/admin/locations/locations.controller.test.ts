import { describe, it } from "vitest";

import {
  assertBadIdIs400,
  assertBodyReachesTheService,
  assertConflictPassesThrough,
  assertNoBodyIsTheDefaultCall,
  assertSiteLayoutRouteIsDeclared,
  assertUnknownBodyKeyIs400,
} from "./locations.controller.spec";

/** `F3.73` plan Task 4.2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 — POST /admin/locations/:id/site-layout", () => {
  it("declares the route on makeSiteLayout", () => {
    assertSiteLayoutRouteIsDeclared();
  });

  it("passes the path id and the parsed body to makeForSite with the caller", async () => {
    await assertBodyReachesTheService();
  });

  it("passes only the location id when there is no body", async () => {
    await assertNoBodyIsTheDefaultCall();
  });

  it("refuses an unknown body key with 400 before the service", async () => {
    await assertUnknownBodyKeyIs400();
  });

  it("refuses a non-uuid id with 400 before the service", async () => {
    await assertBadIdIs400();
  });

  it("passes the service's 409 through unchanged", async () => {
    await assertConflictPassesThrough();
  });
});
