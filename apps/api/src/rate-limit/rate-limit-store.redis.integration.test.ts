import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationRedis } from "../testing/integration-redis-gate";
import {
  assertAnUnreachableRedisFailsOpenToMemory,
  assertEveryKeyHasATtl,
  assertTwoProcessesShareOneBudget,
  closeRedisSuite,
  openRedisSuite,
  type RedisSuite,
} from "./rate-limit-store.redis.integration.spec";

const redisUrl = requireIntegrationRedis({
  item: "F4.17",
  label: "rate-limit store integration tests",
  because:
    "they are the only proof that two API processes count against one Redis budget " +
    "(ADR 0125 decision 3) and that every counter key expires under noeviction.",
});

describe.skipIf(!redisUrl)("F4.17 — the rate-limit store against a real Redis", () => {
  let suite: RedisSuite;

  beforeAll(() => {
    suite = openRedisSuite(redisUrl as string);
  });

  afterAll(async () => {
    await closeRedisSuite(suite);
  });

  it("two processes share one budget: the sixth hit of five is refused", async () => {
    await assertTwoProcessesShareOneBudget(suite);
  });

  it("every counter key carries a TTL", async () => {
    await assertEveryKeyHasATtl(suite);
  });

  it("an unreachable Redis fails open to the in-process window and reads degraded", async () => {
    await assertAnUnreachableRedisFailsOpenToMemory();
  });
});
