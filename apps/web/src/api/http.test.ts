import { describe, it } from "vitest";

import { runAuthFailureTests, runWithAuthTests } from "./http.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("api/http", () => {
  it("clears the session on 401 and keeps it on 403", () => {
    runAuthFailureTests();
  });

  it("adds the bearer token without discarding the caller's headers", () => {
    runWithAuthTests();
  });
});
