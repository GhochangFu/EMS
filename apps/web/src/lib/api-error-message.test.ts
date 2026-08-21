import { describe, it } from "vitest";

import {
  runArrayMessageTests,
  runFallbackTests,
  runNestEnvelopeTests,
  runNonErrorTests,
} from "./api-error-message.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("api error message", () => {
  it("shows the sentence, not the JSON envelope around it", () => {
    runNestEnvelopeTests();
  });

  it("keeps every sentence of a validation array", () => {
    runArrayMessageTests();
  });

  it("passes a non-envelope body through unchanged", () => {
    runFallbackTests();
  });

  it("handles a throw that is not an Error", () => {
    runNonErrorTests();
  });
});
