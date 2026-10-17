import { describe, it } from "vitest";

import {
  assertEveryPatternCompilesWithoutFlags,
  assertEveryPatternCompilesWithTheUFlag,
  assertNoPatternCarriesAUnicodePropertyEscape,
  assertTheWalkReachesTheRealCatalog,
} from "./copilot-tool-definition-patterns.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.265 — every tool definition's pattern is a portable regex", () => {
  it("walks the real propose, read and onboarding definitions for every role", () => {
    assertTheWalkReachesTheRealCatalog();
  });

  it("compiles every pattern without flags, as the provider reads it", () => {
    assertEveryPatternCompilesWithoutFlags();
  });

  it("compiles every pattern with the u flag", () => {
    assertEveryPatternCompilesWithTheUFlag();
  });

  it("carries no Unicode property escape in any pattern", () => {
    assertNoPatternCarriesAUnicodePropertyEscape();
  });
});
