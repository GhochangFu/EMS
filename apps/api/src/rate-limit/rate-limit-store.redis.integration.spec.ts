import { randomUUID } from "node:crypto";

import { createClient } from "redis";
import { expect } from "vitest";

import { readRateLimitConfig } from "./rate-limit-config";
import { rateLimitKey } from "./rate-limit-key";
import { RateLimitStore, type RedisEvalClient } from "./rate-limit-store";
import { RateLimiterService } from "./rate-limiter.service";

/**
 * `F4.17` / ADR 0125 decision 3 against a real Redis — the claim the whole
 * Part A rests on: two API processes (two `RateLimitStore`s, two clients)
 * count against **one** budget, so `api-replica` no longer doubles a limit.
 * Every key it writes carries a TTL (Redis runs `noeviction`).
 */

export type RedisSuite = { url: string; clients: Array<ReturnType<typeof createClient>> };

export function openRedisSuite(url: string): RedisSuite {
  return { url, clients: [] };
}

export async function closeRedisSuite(suite: RedisSuite): Promise<void> {
  await Promise.all(suite.clients.map((client) => client.close()));
}

async function client(suite: RedisSuite): Promise<ReturnType<typeof createClient>> {
  const c = createClient({ url: suite.url, disableOfflineQueue: true });
  await c.connect();
  suite.clients.push(c);
  return c;
}

/** Mid-window, so six hits can never straddle a minute boundary. */
const FIXED_NOW = () => Math.floor(Date.now() / 60_000) * 60_000 + 30_000;

function limiterOver(redis: RedisEvalClient, limit: number): RateLimiterService {
  const config = {
    ...readRateLimitConfig({ RATE_LIMIT_MODE: "enforce" }),
    classLimits: { read: limit, write: limit, heavy: limit },
  };
  const now = FIXED_NOW();
  return new RateLimiterService(config, new RateLimitStore({ redis, now: () => now }), null);
}

export async function assertTwoProcessesShareOneBudget(suite: RedisSuite): Promise<void> {
  const api = limiterOver((await client(suite)) as unknown as RedisEvalClient, 5);
  const replica = limiterOver((await client(suite)) as unknown as RedisEvalClient, 5);
  const subject = `it-${randomUUID()}`;
  const outcomes: boolean[] = [];
  for (let i = 0; i < 6; i += 1) {
    const process = i % 2 === 0 ? api : replica;
    outcomes.push((await process.checkIdentity("write", subject)).refuse);
  }
  // Five allowed across both processes, the sixth refused — not ten allowed.
  expect(outcomes).toEqual([false, false, false, false, false, true]);
  expect(api.health().store).toBe("redis");
  expect(replica.health().store).toBe("redis");
}

export async function assertEveryKeyHasATtl(suite: RedisSuite): Promise<void> {
  const c = await client(suite);
  const store = new RateLimitStore({ redis: c as unknown as RedisEvalClient });
  const key = rateLimitKey("identity", "read", `it-${randomUUID()}`, 1);
  const first = await store.hit(key, 60_000);
  await store.hit(key, 60_000);
  expect(first.backend).toBe("redis");
  const ttl = await c.pTTL(key);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(61_000);
  expect(await c.get(key)).toBe("2");
}

export async function assertAnUnreachableRedisFailsOpenToMemory(): Promise<void> {
  // A port nothing listens on: the client never becomes ready.
  const dead = createClient({
    url: "redis://127.0.0.1:1",
    disableOfflineQueue: true,
    socket: { reconnectStrategy: false },
  });
  dead.on("error", () => undefined);
  await dead.connect().catch(() => undefined);
  const store = new RateLimitStore({ redis: dead as unknown as RedisEvalClient });
  const hit = await store.hit(rateLimitKey("identity", "read", "it-dead", 1), 60_000);
  expect(hit.backend).toBe("memory");
  expect(store.state).toBe("degraded");
  if (dead.isOpen) {
    dead.destroy();
  }
}
