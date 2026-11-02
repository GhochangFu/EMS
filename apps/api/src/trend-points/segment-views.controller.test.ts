import "reflect-metadata";
import { describe, it } from "vitest";

import {
  aBadRangeIsA400NamingTheQuery,
  anOrganizationIdIsA400,
  theDtoAndUserReachTheService,
  theRouteSendsNoStore,
} from "./segment-views.controller.spec";

/** `F4.302` U2 — Vitest entry point for `SiteSegmentViewsController`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.302 — SiteSegmentViewsController (ADR 0108 Amendment 4 item 4)", () => {
  it("a bad range is a 400 naming the query, and the service is not called", () => aBadRangeIsA400NamingTheQuery());
  it("an organizationId is a 400", () => anOrganizationIdIsA400());
  it("the dto and the user reach the service", () => theDtoAndUserReachTheService());
  it("the route sends Cache-Control: no-store", () => theRouteSendsNoStore());
});
