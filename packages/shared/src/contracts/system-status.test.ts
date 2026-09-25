import { describe, it } from "vitest";

import {
  runExtraTopLevelKeyToleratedTest,
  runFullBodyParsesTest,
  runNullPercentParsesTest,
  runStringPercentRejectedTest,
  runUnknownKeyRejectedTest,
  runUnknownStateRejectedTest,
} from "./system-status.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.30 — the system status contract (ADR 0075 decisions 3, 4)", () => {
  it("parses a full, well-formed body", () => {
    runFullBodyParsesTest();
  });

  it("parses dataQuality.percent: null", () => {
    runNullPercentParsesTest();
  });

  it("rejects percent as a string", () => {
    runStringPercentRejectedTest();
  });

  it("rejects an unknown component state", () => {
    runUnknownStateRejectedTest();
  });

  it("rejects an unknown component key", () => {
    runUnknownKeyRejectedTest();
  });

  it("tolerates an extra top-level key", () => {
    runExtraTopLevelKeyToleratedTest();
  });
});
