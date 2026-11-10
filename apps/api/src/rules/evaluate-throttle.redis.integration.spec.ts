import { randomUUID } from "node:crypto";

import { createClient } from "redis";
import { expect } from "vitest";

import { RateLimitStore, type RedisEvalClient } from "../rate-limit/rate-limit-store";
import { EvaluateThrottle, EVALUATE_MIN_INTERVAL_MS } from "./evaluate-throttle";

/**
 * `F4.17` / ADR 0125 Q9 against a real Redis — the `F3.47` evaluate-now
 * window shared by two API processes (two `EvaluateThrottle`s over two
 * clients). Before this, each process held its own `Map` and `api-replica`
 * doubled the bound; the `docker-compose.yml` comment said so.
 */

export type ThrottleSuite = { url: string; clients: Array<ReturnType<typeof createClient>> };

export function openThrottleSuite(url: string): ThrottleSuite {
  return { url, clients: [] };
}

export async function closeThrottleSuite(suite: ThrottleSuite): Promise<void> {
  await Promise.all(suite.clients.map((client) => client.close()));
}

async function processOver(suite: ThrottleSuite): Promise<EvaluateThrottle> {
  const client = createClient({ url: suite.url, disableOfflineQueue: true });
  await client.connect();
  suite.clients.push(client);
  return new EvaluateThrottle(new RateLimitStore({ redis: client as unknown as RedisEvalClient }));
}

const org = () => randomUUID();

export async function assertTwoProcessesShareOneWindow(suite: ThrottleSuite): Promise<void> {
  const api = await processOver(suite);
  const replica = await processOver(suite);
  const key = org();
  expect((await api.claim([key], Date.now())).allowed).toBe(true);
  const refused = await replica.claim([key], Date.now());
  expect(refused.allowed).toBe(false);
  if (!refused.allowed) {
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(EVALUATE_MIN_INTERVAL_MS / 1000);
  }
}

export async function assertAMultiOrgPressStampsEveryKeyAndARefusalStampsNone(
  suite: ThrottleSuite,
): Promise<void> {
  const api = await processOver(suite);
  const replica = await processOver(suite);
  const [a, b, c] = [org(), org(), org()];
  expect((await api.claim([a, b], Date.now())).allowed).toBe(true);
  expect((await replica.claim([a], Date.now())).allowed).toBe(false);
  expect((await replica.claim([b], Date.now())).allowed).toBe(false);
  // [b, c] is refused because b is held — and the refusal must not stamp c.
  expect((await replica.claim([b, c], Date.now())).allowed).toBe(false);
  expect((await api.claim([c], Date.now())).allowed).toBe(true);
}

export async function assertTheWindowExpiresInRedis(suite: ThrottleSuite): Promise<void> {
  const api = await processOver(suite);
  const key = org();
  await api.claim([key], Date.now());
  const ttl = await suite.clients[suite.clients.length - 1]?.pTTL(`rl:v1:evaluate:${key}`);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(EVALUATE_MIN_INTERVAL_MS);
}
