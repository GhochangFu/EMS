import { describe, it } from "vitest";

import { runAssetTemplatesControllerTests } from "./asset-templates.controller.spec";

/** `F2.13` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.13 — asset template controller route order", () => {
  it("declares the literal /stock route before the parameterised /:id route", () => {
    runAssetTemplatesControllerTests();
  });
});
