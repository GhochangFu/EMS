import { describe, it } from "vitest";

import { runCrossRefPointKeyTests } from "./asset-templates-cross-refs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates cross references (F2.9)", () => {
  it("reports the point keys a bms-calc-v2 formula names inside its own text", () => {
    runCrossRefPointKeyTests();
  });
});
