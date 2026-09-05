import { describe, it } from "vitest";

import {
  runBoundsCheckTests,
  runBoundsComeFromSharedTests,
  runGridPassTests,
  runIntervalOnlyWhenScheduledTests,
  runParseOptionalSecondsTests,
  runTriggerChangeTests,
  runV2IsScheduledOnlyTests,
  runValidConfigTests,
} from "./template-calc-config.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template calc config", () => {
  it("reads its bounds from the constants the server's schema reads", () => {
    runBoundsComeFromSharedTests();
  });

  it("accepts a well-formed derived point under either trigger", () => {
    runValidConfigTests();
  });

  it("requires an interval when scheduled, and refuses one when streaming", () => {
    runIntervalOnlyWhenScheduledTests();
  });

  it("treats both bounds as inclusive and refuses a fraction", () => {
    runBoundsCheckTests();
  });

  it("clears the interval when switching to streaming, and seeds none when scheduling", () => {
    runTriggerChangeTests();
  });

  it("reads an emptied seconds box as unset rather than zero", () => {
    runParseOptionalSecondsTests();
  });

  it("reports every derived point in the grid, addressed by row", () => {
    runGridPassTests();
  });

  it("refuses a streaming bms-calc-v2 point, and only that one (ADR 0055 decision 10)", () => {
    runV2IsScheduledOnlyTests();
  });
});
