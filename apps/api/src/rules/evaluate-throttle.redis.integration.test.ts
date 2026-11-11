import { afterAll, beforeAll, describe, it } from "vitest";

import { requireIntegrationRedis } from "../testing/integration-redis-gate";
import {
  assertAMultiOrgPressStampsEveryKeyAndARefusalStampsNone,
  assertTheWindowExpiresInRedis,
  assertTwoProcessesShareOneWindow,
  closeThrottleSuite,
  openThrottleSuite,
  type ThrottleSuite,
} from "./evaluate-throttle.redis.integration.spec";

const redisUrl = requireIntegrationRedis({
  item: "F4.17",
  label: "shared evaluate-throttle integration tests",
  because:
    "they are the only proof that api and api-replica share one F3.47 evaluate-now " +
    "window (ADR 0125 Q9) instead of one Map each.",
});

describe.skipIf(!redisUrl)("F4.17 — the F3.47 evaluate window shared through Redis", () => {
  let suite: ThrottleSuite;

  beforeAll(() => {
    suite = openThrottleSuite(redisUrl as string);
  });

  afterAll(async () => {
    await closeThrottleSuite(suite);
  });

  it("two processes share one window: the replica's press inside it is refused", async () => {
    await assertTwoProcessesShareOneWindow(suite);
  });

  it("a multi-organization press stamps every key, and a refusal stamps none", async () => {
    await assertAMultiOrgPressStampsEveryKeyAndARefusalStampsNone(suite);
  });

  it("the window's key expires in Redis", async () => {
    await assertTheWindowExpiresInRedis(suite);
  });
});
