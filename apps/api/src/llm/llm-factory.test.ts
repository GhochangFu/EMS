import { describe, it } from "vitest";

import {
  assertClassifyProviderErrorMapsTheTypedClasses,
  assertEachNameBuildsItsAdapter,
} from "./llm-factory.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("LLM provider factory (F3.21, ADR 0090 Amendment 1 A1/A5)", () => {
  it("builds the adapter each provider name selects", () => {
    assertEachNameBuildsItsAdapter();
  });

  it("maps provider errors to one test status", () => {
    assertClassifyProviderErrorMapsTheTypedClasses();
  });
});
