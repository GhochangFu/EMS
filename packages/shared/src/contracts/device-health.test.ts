import { describe, it } from "vitest";

import {
  runEdgeServedRequiredTest,
  runFullFixturesParseTest,
  runSeventhReasonRefusedTest,
  runUnknownStateRefusedTest,
} from "./device-health.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.16 — the device-health contracts (ADR 0127)", () => {
  it("parses a full fixture of each response", () => {
    runFullFixturesParseTest();
  });

  it("refuses an unknown state", () => {
    runUnknownStateRefusedTest();
  });

  it("refuses a seventh drop reason", () => {
    runSeventhReasonRefusedTest();
  });

  it("requires edgeServed", () => {
    runEdgeServedRequiredTest();
  });
});
