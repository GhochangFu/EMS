import { describe, it } from "vitest";

import {
  aZodErrorIsA400WithFlatten,
  bothRoutesSendNoStore,
  filterOptionsPassesTheUser,
  theDtoAndUserReachTheService,
} from "./reports.controller.energy-view.spec";

/** `F4.298` U4 — Vitest entry point for the energy view routes. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.298 — ReportsController energy view routes (ADR 0108 decision 2)", () => {
  it("the dto and the user reach the service", () => theDtoAndUserReachTheService());
  it("a ZodError is a 400 with flatten()", () => aZodErrorIsA400WithFlatten());
  it("filter-options passes the user", () => filterOptionsPassesTheUser());
  it("both routes send Cache-Control: no-store", () => bothRoutesSendNoStore());
});
