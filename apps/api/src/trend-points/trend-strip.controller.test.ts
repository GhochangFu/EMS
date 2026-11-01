import "reflect-metadata";
import { describe, it } from "vitest";

import {
  anUnknownKeyIsA400,
  anUnknownRangeIsA400WithFlatten,
  theDtoAndUserReachTheService,
  theRouteSendsNoStore,
} from "./trend-strip.controller.spec";

/** `F4.301` U3 — Vitest entry point for `SiteTrendStripController`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.301 — SiteTrendStripController (ADR 0108 Amendment 2 item 3)", () => {
  it("range=1y is a 400 with flatten() and the service is not called", () => anUnknownRangeIsA400WithFlatten());
  it("an unknown query key is a 400", () => anUnknownKeyIsA400());
  it("the dto and the user reach the service", () => theDtoAndUserReachTheService());
  it("the route sends Cache-Control: no-store", () => theRouteSendsNoStore());
});
