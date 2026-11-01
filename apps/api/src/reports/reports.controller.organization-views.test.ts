import { describe, it } from "vitest";

import {
  anOrganizationViewsZodErrorIsA400WithFlatten,
  aServiceErrorIsRethrown,
  theDtoAndUserReachTheOrganizationViewsService,
  theOrganizationViewsRouteSendsNoStore,
} from "./reports.controller.organization-views.spec";

/** `F4.299` U4 — Vitest entry point for the organization-views route. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.299 — ReportsController organization-views route (ADR 0108 Amendment 1, 7.1)", () => {
  it("the dto and the user reach the service", () => theDtoAndUserReachTheOrganizationViewsService());
  it("a ZodError is a 400 with flatten()", () => anOrganizationViewsZodErrorIsA400WithFlatten());
  it("a service error is rethrown", () => aServiceErrorIsRethrown());
  it("the route sends Cache-Control: no-store", () => theOrganizationViewsRouteSendsNoStore());
});
