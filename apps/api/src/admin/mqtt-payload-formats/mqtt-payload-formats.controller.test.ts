import { describe, it } from "vitest";

import { eachRouteReachesItsServiceMethod, theRoutesAreMounted } from "./mqtt-payload-formats.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.334 — the payload format catalog routes (ADR 0116 decision 5)", () => {
  it("mounts the routes, test before :code, DELETE 204", () => theRoutesAreMounted());
  it("hands each route's raw input to its service method", async () => eachRouteReachesItsServiceMethod());
});
