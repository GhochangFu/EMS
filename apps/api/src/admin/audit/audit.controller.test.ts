import { describe, it } from "vitest";

import { runAuditControllerTests } from "./audit.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("audit controller", () => {
  it("maps ZodError to 400 and sets the export response headers", async () => {
    await runAuditControllerTests();
  });
});
