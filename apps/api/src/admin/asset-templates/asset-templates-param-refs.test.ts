import { describe, it } from "vitest";

import { runParamRefKeyTests } from "./asset-templates-param-refs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates parameter references (E4.1a)", () => {
  it("reports the $keys a bms-calc-v3 formula or KPI names inside its own text, and never throws", () => {
    runParamRefKeyTests();
  });
});
