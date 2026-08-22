import { describe, it } from "vitest";

import {
  runBudgetTests,
  runForbiddenTests,
  runNonRetryableStatusTests,
  runPlainErrorTests,
  runRetryableStatusTests,
} from "./query-retry.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("query retry", () => {
  it("refuses to retry the measured 403", () => {
    runForbiddenTests();
  });

  it("treats every other 4xx as final", () => {
    runNonRetryableStatusTests();
  });

  it("keeps retrying 408, 429 and 5xx", () => {
    runRetryableStatusTests();
  });

  it("leaves the plain-Error clients exactly as they were", () => {
    runPlainErrorTests();
  });

  it("spends the same retry budget as before", () => {
    runBudgetTests();
  });
});
