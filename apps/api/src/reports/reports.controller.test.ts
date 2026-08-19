import { describe, it } from "vitest";

import {
  runReportsControllerHeaderTests,
  runReportsXlsxHeaderTests,
} from "./reports.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("reports controller", () => {
  it("marks the energy CSV export no-store, matching the audit export (F4.30)", () => {
    runReportsControllerHeaderTests();
  });

  it("marks the energy XLSX export no-store and sends the buffer verbatim (F4.51)", async () => {
    await runReportsXlsxHeaderTests();
  });
});
