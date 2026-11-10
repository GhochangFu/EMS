import { describe, it } from "vitest";

import {
  assertAHeavyRouteUsesTheHeavyLimit,
  assertAMissingTokenSpendsNoBudget,
  assertAWriteCountsInTheWriteClass,
  assertNoLimiterMeansNoStage2,
  assertShadowNeverRefuses,
  assertTheHitAfterTheReadLimitIsA429WithItsHeaders,
  assertTwoUsersHaveTwoBudgets,
} from "./jwt-auth.guard.rate-limit.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("JwtAuthGuard — Stage 2 rate limit (F4.17, ADR 0125)", () => {
  it("the hit after the read limit is a429 with its headers", async () => {
    await assertTheHitAfterTheReadLimitIsA429WithItsHeaders();
  });

  it("two users have two budgets", async () => {
    await assertTwoUsersHaveTwoBudgets();
  });

  it("a write counts in the write class", async () => {
    await assertAWriteCountsInTheWriteClass();
  });

  it("a heavy route uses the heavy limit", async () => {
    await assertAHeavyRouteUsesTheHeavyLimit();
  });

  it("a missing token spends no budget", async () => {
    await assertAMissingTokenSpendsNoBudget();
  });

  it("shadow never refuses", async () => {
    await assertShadowNeverRefuses();
  });

  it("no limiter means no stage2", async () => {
    await assertNoLimiterMeansNoStage2();
  });

});
