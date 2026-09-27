import { describe, it } from "vitest";

import {
  aNon55P03ErrorIsRethrownAtOnce,
  raises55P03OnceThenTheSecondCallSucceeds,
  resetRoleRunsAfterAThrow,
  retryOnConcurrentRefreshRetriesOnlyThatCode,
  theBudgetIsExhaustedAndTheLastErrorIsThrown,
  theDefaultBudgetIsFiveAttemptsThreeSeconds,
} from "./cagg-materialize.spec";

/**
 * `F4.149` — Vitest entry point for `retryOnConcurrentRefresh` and the
 * `materializeCompleteBuckets` retry it wraps. Assertions live in the sibling
 * `.spec` (§4.6/ADR 0014); this file only runs them.
 */
describe("F4.149 — materializeCompleteBuckets retries a concurrent refresh", () => {
  it("raises 55P03 once, then the second call succeeds", async () => {
    await raises55P03OnceThenTheSecondCallSucceeds();
  });

  it("a non-55P03 error is rethrown at once", async () => {
    await aNon55P03ErrorIsRethrownAtOnce();
  });

  it("the budget is exhausted and the last error is thrown", async () => {
    await theBudgetIsExhaustedAndTheLastErrorIsThrown();
  });

  it("RESET ROLE runs after a throw, and the client is released once", async () => {
    await resetRoleRunsAfterAThrow();
  });

  it("the default budget is five attempts, three-second delay", () => {
    theDefaultBudgetIsFiveAttemptsThreeSeconds();
  });

  it("retryOnConcurrentRefresh retries only a 55P03 conflict", async () => {
    await retryOnConcurrentRefreshRetriesOnlyThatCode();
  });
});
