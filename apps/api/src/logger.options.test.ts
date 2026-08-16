import { describe, it } from "vitest";

import { runLoggerRedactionTests } from "./logger.options.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("logger.options", () => {
  it("censors credential-bearing headers without eating the request log", () => {
    runLoggerRedactionTests();
  });
});
