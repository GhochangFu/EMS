import { describe, it } from "vitest";

import { templateRefusesAWellFormedMimic } from "./asset-templates-content.schema.mimic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates content schema — mimic (F3.32, ADR 0079)", () => {
  it("refuses a mimic widget with a well-formed config", () => {
    templateRefusesAWellFormedMimic();
  });
});
