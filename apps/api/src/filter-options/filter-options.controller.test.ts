import { describe, it } from "vitest";

import * as spec from "./filter-options.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 U3 — GET /filter-options (ADR 0132 decision 2)", () => {
  it("is behind JwtAuthGuard", () => spec.assertTheRouteIsGuarded());
  it("answers the service's read for the caller", () => spec.assertTheHandlerAnswersTheCallersOptions());
});
