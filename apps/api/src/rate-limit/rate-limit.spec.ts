import { HttpException } from "@nestjs/common";
import { expect, vi } from "vitest";

import { rateLimitHealthSchema, rateLimitedErrorSchema } from "@bms/shared";

import { MetricsService } from "../observability/metrics.service";

import { createClientIpLimitMiddleware, isLoginRequest } from "./client-ip-limit.middleware";
import { refuseRateLimitedHandshake } from "./handshake-limit";
import { rateLimitClassFor } from "./rate-limit-class.decorator";
import { DEFAULT_RATE_LIMITS, readRateLimitConfig, type RateLimitConfig } from "./rate-limit-config";
import { withRateLimitVerdict } from "./rate-limit-health";
import { clientAddress, fixedWindow, ipSubject, rateLimitKey } from "./rate-limit-key";
import { MemoryWindowStore, RateLimitStore, type RedisEvalClient } from "./rate-limit-store";
import { RateLimiterService, type RateLimitMetrics } from "./rate-limiter.service";
import { rateLimitedBody, rateLimitedException, rateLimitedHeaders } from "./rate-limited.exception";

/**
 * `F4.17` / ADR 0125 Part A — the limiter's pure pieces and its two HTTP-free
 * call sites (the Stage 1 middleware and the handshake), against fakes. The
 * shared-store claim — two processes, one budget — needs a real Redis and is
 * `rate-limit-store.redis.integration.spec.ts`.
 */

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0); // a window boundary

function config(overrides: Partial<RateLimitConfig> = {}): RateLimitConfig {
  return { ...readRateLimitConfig({ RATE_LIMIT_MODE: "enforce" }), ...overrides };
}

function limiter(
  overrides: Partial<RateLimitConfig> = {},
  now: () => number = () => T0,
): { service: RateLimiterService; metrics: RateLimitMetrics & { calls: string[] } } {
  const calls: string[] = [];
  const metrics = {
    calls,
    recordRateLimitDecision: (stage: string, bucket: string, outcome: string) =>
      calls.push(`${stage}/${bucket}/${outcome}`),
  };
  const store = new RateLimitStore({ redis: null, now });
  return { service: new RateLimiterService(config(overrides), store, metrics), metrics };
}

// ── config ──────────────────────────────────────────────────────────────────

export function assertTheDefaultsAreTheAdrNumbersAndShadow(): void {
  const parsed = readRateLimitConfig({});
  expect(parsed.mode).toBe("shadow");
  expect(parsed.trustProxyHops).toBe(0);
  expect(parsed.classLimits).toEqual({ read: 600, write: 120, heavy: 12 });
  expect(parsed.ipLimits).toEqual({ ip: 1200, login: 10, ws: 30 });
  expect(DEFAULT_RATE_LIMITS).toEqual({ read: 600, write: 120, heavy: 12, ip: 1200, login: 10, ws: 30 });
}

export function assertEveryEnvNameIsRead(): void {
  const parsed = readRateLimitConfig({
    RATE_LIMIT_MODE: "enforce",
    API_TRUST_PROXY_HOPS: "2",
    RATE_LIMIT_READ_PER_MIN: "1",
    RATE_LIMIT_WRITE_PER_MIN: "2",
    RATE_LIMIT_HEAVY_PER_MIN: "3",
    RATE_LIMIT_IP_PER_MIN: "4",
    RATE_LIMIT_LOGIN_PER_MIN: "5",
    RATE_LIMIT_WS_HANDSHAKE_PER_MIN: "6",
  });
  expect(parsed).toEqual({
    mode: "enforce",
    trustProxyHops: 2,
    classLimits: { read: 1, write: 2, heavy: 3 },
    ipLimits: { ip: 4, login: 5, ws: 6 },
  });
}

export function assertAMalformedValueFailsBoot(): void {
  expect(() => readRateLimitConfig({ RATE_LIMIT_MODE: "enforced" })).toThrow(/RATE_LIMIT_MODE/);
  expect(() => readRateLimitConfig({ RATE_LIMIT_READ_PER_MIN: "0" })).toThrow(/RATE_LIMIT_READ_PER_MIN/);
  expect(() => readRateLimitConfig({ RATE_LIMIT_HEAVY_PER_MIN: "12.5" })).toThrow(/HEAVY/);
  expect(() => readRateLimitConfig({ API_TRUST_PROXY_HOPS: "-1" })).toThrow(/API_TRUST_PROXY_HOPS/);
  expect(() => readRateLimitConfig({ API_TRUST_PROXY_HOPS: "11" })).toThrow(/API_TRUST_PROXY_HOPS/);
  // An empty value is "unset", not malformed: compose files write `KEY: ""`.
  expect(readRateLimitConfig({ RATE_LIMIT_MODE: "" }).mode).toBe("shadow");
}

// ── keys and client addresses ───────────────────────────────────────────────

export function assertTheKeyShapeAndHashing(): void {
  expect(rateLimitKey("identity", "read", "00000000-0000-4000-8000-000000000001", 7)).toBe(
    "rl:v1:identity:read:00000000-0000-4000-8000-000000000001:7",
  );
  const long = rateLimitKey("ip", "ip", "x".repeat(65), 7);
  expect(long).toMatch(/^rl:v1:ip:ip:h_[0-9a-f]{32}:7$/);
  // A subject with a character outside the key alphabet is hashed too, so a
  // subject can never inject a `:` that shifts the window field.
  expect(rateLimitKey("identity", "read", "sub:a b", 7)).toMatch(/^rl:v1:identity:read:h_[0-9a-f]{32}:7$/);
}

export function assertTheFixedWindow(): void {
  expect(fixedWindow(T0, 60_000)).toEqual({ index: T0 / 60_000, resetMs: 60_000 });
  expect(fixedWindow(T0 + 59_999, 60_000)).toEqual({ index: T0 / 60_000, resetMs: 1 });
  expect(fixedWindow(T0 + 60_000, 60_000).index).toBe(T0 / 60_000 + 1);
}

export function assertIpSubjectsAreNormalised(): void {
  expect(ipSubject("203.0.113.7")).toBe("203.0.113.7");
  expect(ipSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
  expect(ipSubject("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
  expect(ipSubject("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
  expect(ipSubject("2001:0db8:0001:0002::1")).toBe("2001:db8:1:2::/64");
  expect(ipSubject("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  expect(ipSubject(undefined)).toBe("unknown");
  expect(ipSubject("not-an-ip")).toBe("unknown");
}

export function assertHopsZeroIgnoresAForgedHeader(): void {
  expect(clientAddress("10.0.0.5", "198.51.100.9", 0)).toBe("10.0.0.5");
}

export function assertHopsTwoReadsTheClientBehindCaddyAndNginx(): void {
  // nginx's socket peer, then `X-Forwarded-For: <client>, <caddy>` from Caddy + nginx.
  expect(clientAddress("172.18.0.4", "203.0.113.7, 172.18.0.1", 2)).toBe("203.0.113.7");
  // A client that forges a prefix still lands on its real address: the proxies append.
  expect(clientAddress("172.18.0.4", "6.6.6.6, 203.0.113.7, 172.18.0.1", 2)).toBe("203.0.113.7");
  // A chain shorter than the hop count is keyed on the socket peer, NOT on its
  // leftmost entry as Express would: that entry is the client's own (M2).
  expect(clientAddress("172.18.0.4", "203.0.113.7", 2)).toBe("172.18.0.4");
  expect(clientAddress("172.18.0.4", "6.6.6.6", 2)).toBe("172.18.0.4");
  expect(clientAddress("172.18.0.4", undefined, 2)).toBe("172.18.0.4");
  expect(clientAddress("172.18.0.4", " , ", 2)).toBe("172.18.0.4");
  expect(clientAddress("172.18.0.4", ["203.0.113.7", "172.18.0.1"], 2)).toBe("203.0.113.7");
}

// ── the stores ──────────────────────────────────────────────────────────────

export function assertTheMemoryWindowCountsAndExpires(): void {
  const memory = new MemoryWindowStore();
  expect(memory.hit("k", 1_000, T0)).toBe(1);
  expect(memory.hit("k", 1_000, T0 + 999)).toBe(2);
  expect(memory.hit("k", 1_000, T0 + 1_000)).toBe(1);
}

export function assertTheMemoryWindowIsBounded(): void {
  const memory = new MemoryWindowStore(3);
  for (const key of ["a", "b", "c", "d", "e"]) {
    memory.hit(key, 60_000, T0);
  }
  expect(memory.size).toBeLessThanOrEqual(3);
}

export function assertAnIpFloodCannotResetAnIdentityCounter(): void {
  // L1: a flood of distinct Stage 1 subjects drops IP counters first, so the
  // flooder's own Stage 2 budget survives it.
  const memory = new MemoryWindowStore(10);
  const identity = rateLimitKey("identity", "write", "u1", 1);
  memory.hit(identity, 60_000, T0);
  memory.hit(identity, 60_000, T0);
  for (let i = 0; i < 50; i += 1) {
    memory.hit(rateLimitKey("ip", "ip", `198.51.100.${i}`, 1), 60_000, T0);
  }
  expect(memory.hit(identity, 60_000, T0)).toBe(3);
}

function fakeRedis(reply: () => Promise<unknown>, isReady = true): RedisEvalClient & { evals: number } {
  const client = {
    evals: 0,
    isReady,
    eval: () => {
      client.evals += 1;
      return reply();
    },
  };
  return client;
}

export async function assertRedisIsTheStoreWhenItAnswers(): Promise<void> {
  const redis = fakeRedis(async () => [5, 59_000]);
  const store = new RateLimitStore({ redis, now: () => T0 + 1_000 });
  expect(await store.hit("k", 60_000)).toEqual({ count: 5, resetMs: 59_000, backend: "redis" });
  expect(store.state).toBe("redis");
}

export async function assertAFailingRedisFallsBackToMemoryAndIsCounted(): Promise<void> {
  const onStoreError = vi.fn();
  const redis = fakeRedis(async () => {
    throw new Error("ECONNRESET");
  });
  const store = new RateLimitStore({ redis, now: () => T0, onStoreError });
  const first = await store.hit("k", 60_000);
  const second = await store.hit("k", 60_000);
  expect(first).toEqual({ count: 1, resetMs: 60_000, backend: "memory" });
  expect(second.count).toBe(2);
  expect(onStoreError).toHaveBeenCalledTimes(2);
  expect(store.state).toBe("degraded");
}

export async function assertANotReadyRedisIsNeverCalled(): Promise<void> {
  const redis = fakeRedis(async () => [1, 1], false);
  const store = new RateLimitStore({ redis, now: () => T0 });
  // Degraded before any request: /health is never counted, so it must not
  // wait for one to learn Redis is down (code review, correctness 2).
  expect(store.state).toBe("degraded");
  expect((await store.hit("k", 60_000)).backend).toBe("memory");
  expect(redis.evals).toBe(0);
  expect(store.state).toBe("degraded");
}

export async function assertASlowRedisTimesOutToMemory(): Promise<void> {
  const redis = fakeRedis(() => new Promise(() => undefined));
  const store = new RateLimitStore({ redis, now: () => T0, timeoutMs: 10 });
  expect((await store.hit("k", 60_000)).backend).toBe("memory");
}

export async function assertAnUnexpectedReplyFallsBack(): Promise<void> {
  const redis = fakeRedis(async () => "OK");
  const store = new RateLimitStore({ redis, now: () => T0 });
  expect((await store.hit("k", 60_000)).backend).toBe("memory");
}

export async function assertNoRedisReadsMemoryNotDegraded(): Promise<void> {
  const store = new RateLimitStore({ redis: null, now: () => T0 });
  await store.hit("k", 60_000);
  expect(store.state).toBe("memory");
}

export async function assertTheMetricNamesAreTheOnesTheShadowWeekReads(): Promise<void> {
  const metrics = new MetricsService();
  metrics.recordRateLimitDecision("identity", "read", "shadow_refused");
  metrics.recordRateLimitStoreError();
  const text = await metrics.registry.metrics();
  // The registry adds a default `service` label after ours.
  expect(text).toMatch(
    /^bms_rate_limit_decisions_total\{stage="identity",bucket="read",outcome="shadow_refused"[^}]*\} 1$/m,
  );
  expect(text).toMatch(/^bms_rate_limit_store_errors_total(\{[^}]*\})? 1$/m);
}

export async function assertRedisRecoveryClearsDegraded(): Promise<void> {
  let fail = true;
  const redis = fakeRedis(async () => {
    if (fail) {
      throw new Error("down");
    }
    return [1, 60_000];
  });
  const store = new RateLimitStore({ redis, now: () => T0 });
  await store.hit("k", 60_000);
  expect(store.state).toBe("degraded");
  fail = false;
  await store.hit("k", 60_000);
  expect(store.state).toBe("redis");
}

// ── the limiter ─────────────────────────────────────────────────────────────

export async function assertEnforceRefusesTheHitAfterTheLimit(): Promise<void> {
  const { service, metrics } = limiter({ classLimits: { read: 2, write: 2, heavy: 1 } });
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  const third = await service.checkIdentity("read", "u1");
  expect(third).toEqual({
    refuse: true,
    refusal: { bucket: "read", limit: 2, windowMs: 60_000, resetMs: 60_000 },
  });
  expect(metrics.calls).toEqual([
    "identity/read/allowed",
    "identity/read/allowed",
    "identity/read/refused",
  ]);
}

export async function assertEachIdentityHasItsOwnBudget(): Promise<void> {
  const { service } = limiter({ classLimits: { read: 1, write: 1, heavy: 1 } });
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  expect((await service.checkIdentity("read", "u2")).refuse).toBe(false);
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(true);
}

export async function assertEachClassHasItsOwnBudget(): Promise<void> {
  const { service } = limiter({ classLimits: { read: 1, write: 1, heavy: 1 } });
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  expect((await service.checkIdentity("write", "u1")).refuse).toBe(false);
  expect((await service.checkIdentity("heavy", "u1")).refuse).toBe(false);
}

export async function assertTheNextWindowResets(): Promise<void> {
  let now = T0;
  const { service } = limiter({ classLimits: { read: 1, write: 1, heavy: 1 } }, () => now);
  await service.checkIdentity("read", "u1");
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(true);
  now = T0 + 60_000;
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
}

export async function assertShadowCountsLogsOnceAndNeverRefuses(): Promise<void> {
  const { service, metrics } = limiter({ mode: "shadow", classLimits: { read: 1, write: 1, heavy: 1 } });
  const warn = vi.spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, "warn");
  warn.mockImplementation(() => undefined);
  for (let i = 0; i < 4; i += 1) {
    expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  }
  expect(metrics.calls).toEqual([
    "identity/read/allowed",
    "identity/read/shadow_refused",
    "identity/read/shadow_refused",
    "identity/read/shadow_refused",
  ]);
  expect(warn).toHaveBeenCalledTimes(1);
  // The subject — a user id or a client address — is not in the line.
  expect(warn.mock.calls[0]?.[0]).not.toContain("u1");
}

export async function assertOffMakesNoStoreCall(): Promise<void> {
  const redis = fakeRedis(async () => [1_000_000, 1]);
  const store = new RateLimitStore({ redis, now: () => T0 });
  const service = new RateLimiterService(config({ mode: "off" }), store, null);
  expect((await service.checkIdentity("read", "u1")).refuse).toBe(false);
  expect((await service.checkIp("ip", "203.0.113.7")).refuse).toBe(false);
  expect(redis.evals).toBe(0);
}

export async function assertIpBucketsUseTheirOwnLimits(): Promise<void> {
  const { service } = limiter({ ipLimits: { ip: 100, login: 1, ws: 1 } });
  expect((await service.checkIp("login", "203.0.113.7")).refuse).toBe(false);
  expect((await service.checkIp("login", "203.0.113.7")).refuse).toBe(true);
  expect((await service.checkIp("ip", "203.0.113.7")).refuse).toBe(false);
  // The IPv4-mapped form is the same client.
  expect((await service.checkIp("login", "::ffff:203.0.113.7")).refuse).toBe(true);
}

// ── classes, refusal shape, health ──────────────────────────────────────────

export function assertTheMethodDefaultsAndTheOverride(): void {
  expect(rateLimitClassFor("GET", undefined)).toBe("read");
  expect(rateLimitClassFor("head", undefined)).toBe("read");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect(rateLimitClassFor(method, undefined)).toBe("write");
  }
  expect(rateLimitClassFor("GET", "heavy")).toBe("heavy");
  expect(rateLimitClassFor("POST", "heavy")).toBe("heavy");
}

export function assertTheRefusalBodyAndHeaders(): void {
  const refusal = { bucket: "heavy", limit: 12, windowMs: 60_000, resetMs: 41_200 };
  const body = rateLimitedBody(refusal);
  expect(rateLimitedErrorSchema.parse(body)).toEqual({
    statusCode: 429,
    error: "Too Many Requests",
    code: "rate_limited",
    message: "Too many requests. Try again in 42 seconds.",
    retryAfterSeconds: 42,
  });
  expect(rateLimitedHeaders(refusal)).toEqual({
    "Retry-After": "42",
    "RateLimit-Policy": '"heavy";q=12;w=60',
    RateLimit: '"heavy";r=0;t=42',
  });
  const exception = rateLimitedException(refusal);
  expect(exception).toBeInstanceOf(HttpException);
  expect(exception.getStatus()).toBe(429);
  expect(exception.getResponse()).toEqual(body);
  // Never "0 seconds": a refusal in the last millisecond still says wait 1.
  expect(rateLimitedBody({ ...refusal, resetMs: 1 }).retryAfterSeconds).toBe(1);
  expect(rateLimitedBody({ ...refusal, resetMs: 1 }).message).toBe("Too many requests. Try again in 1 second.");
}

export function assertTheHealthSection(): void {
  const base = {
    status: "ok" as const,
    queue: { configured: false } as never,
  };
  expect(withRateLimitVerdict(base, undefined)).toBe(base);
  expect(withRateLimitVerdict(base, { store: "memory" })).toEqual({
    ...base,
    rateLimit: { store: "memory" },
  });
  expect(withRateLimitVerdict(base, { store: "degraded" }).status).toBe("degraded");
  expect(withRateLimitVerdict(base, { store: "redis" }).status).toBe("ok");
  // Only `degraded` changes the verdict: a body already degraded by another
  // section stays degraded whatever the store reads.
  const degradedBase = { ...base, status: "degraded" as const };
  expect(withRateLimitVerdict(degradedBase, { store: "redis" }).status).toBe("degraded");
  expect(withRateLimitVerdict(degradedBase, { store: "memory" }).status).toBe("degraded");
  // L2: the public body never names the mode.
  expect(rateLimitHealthSchema.safeParse({ store: "redis" }).success).toBe(true);
  expect(rateLimitHealthSchema.safeParse({ mode: "shadow", store: "redis" }).success).toBe(false);
  expect(limiter({ mode: "off" }).service.health()).toEqual({ store: "memory" });
}

// ── Stage 1 middleware ──────────────────────────────────────────────────────

type FakeRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  set(headers: Record<string, string>): FakeRes;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(headers) {
      Object.assign(res.headers, headers);
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function runMiddleware(
  middleware: ReturnType<typeof createClientIpLimitMiddleware>,
  request: { path: string; method: string; ip?: string; forwardedFor?: string },
): Promise<{ res: FakeRes; nextCalled: boolean }> {
  const req = {
    path: request.path,
    method: request.method,
    socket: { remoteAddress: request.ip },
    headers: request.forwardedFor ? { "x-forwarded-for": request.forwardedFor } : {},
  };
  const res = fakeRes();
  let nextCalled = false;
  await new Promise<void>((resolve) => {
    const next = () => {
      nextCalled = true;
      resolve();
    };
    middleware(req as never, res as never, next);
    // A refusal never calls next; give the async body a turn to finish.
    setTimeout(resolve, 20);
  });
  return { res, nextCalled };
}

export async function assertStage1RefusesTheEleventhLogin(): Promise<void> {
  const { service } = limiter();
  const middleware = createClientIpLimitMiddleware(service);
  const login = { path: "/api/v1/auth/login", method: "POST", ip: "203.0.113.7" };
  for (let i = 0; i < 10; i += 1) {
    expect((await runMiddleware(middleware, login)).nextCalled).toBe(true);
  }
  const { res, nextCalled } = await runMiddleware(middleware, login);
  expect(nextCalled).toBe(false);
  expect(res.statusCode).toBe(429);
  expect(rateLimitedErrorSchema.parse(res.body).code).toBe("rate_limited");
  expect(res.headers["Retry-After"]).toBe("60");
  expect(res.headers["RateLimit-Policy"]).toBe('"login";q=10;w=60');
  // Another client is untouched.
  expect((await runMiddleware(middleware, { ...login, ip: "203.0.113.8" })).nextCalled).toBe(true);
}

export async function assertStage1NeverCountsHealthOrMetrics(): Promise<void> {
  const { service, metrics } = limiter({ ipLimits: { ip: 1, login: 1, ws: 1 } });
  const middleware = createClientIpLimitMiddleware(service);
  for (const path of ["/health", "/health/ready", "/metrics", "/health", "/metrics"]) {
    expect((await runMiddleware(middleware, { path, method: "GET", ip: "203.0.113.7" })).nextCalled).toBe(true);
  }
  expect(metrics.calls).toEqual([]);
}

export async function assertStage1CountsEveryApiRouteInOneIpBucket(): Promise<void> {
  const { service } = limiter({ ipLimits: { ip: 2, login: 10, ws: 1 } });
  const middleware = createClientIpLimitMiddleware(service);
  const ip = "203.0.113.7";
  expect((await runMiddleware(middleware, { path: "/api/v1/alarms", method: "GET", ip })).nextCalled).toBe(true);
  expect(
    (await runMiddleware(middleware, { path: "/api/v1/public/appearance", method: "GET", ip })).nextCalled,
  ).toBe(true);
  expect((await runMiddleware(middleware, { path: "/api/v1/assets", method: "POST", ip })).res.statusCode).toBe(429);
}

export async function assertAnUpperCasePathIsStillCounted(): Promise<void> {
  // H1: Express routes `/api/V1/...` and `/API/v1/Auth/login` to the same
  // handlers, so both must be counted — and the login variant in `login`.
  const { service } = limiter({ ipLimits: { ip: 100, login: 1, ws: 1 } });
  const middleware = createClientIpLimitMiddleware(service);
  const ip = "203.0.113.7";
  expect((await runMiddleware(middleware, { path: "/api/V1/auth/login", method: "POST", ip })).nextCalled).toBe(true);
  const second = await runMiddleware(middleware, { path: "/API/v1/Auth/Login", method: "POST", ip });
  expect(second.res.statusCode).toBe(429);
  expect(second.res.headers["RateLimit-Policy"]).toBe('"login";q=1;w=60');
}

export async function assertAProbeInAnyCaseIsExempt(): Promise<void> {
  // Express routes `/HEALTH` and `/health/` to the health controller too, and
  // the exemption compares the same normalised path, so neither is counted.
  const { service, metrics } = limiter({ ipLimits: { ip: 100, login: 1, ws: 1 } });
  const middleware = createClientIpLimitMiddleware(service);
  await runMiddleware(middleware, { path: "/HEALTH", method: "GET", ip: "203.0.113.7" });
  await runMiddleware(middleware, { path: "/health/", method: "GET", ip: "203.0.113.7" });
  await runMiddleware(middleware, { path: "/Metrics", method: "GET", ip: "203.0.113.7" });
  expect(metrics.calls).toEqual([]);
  // A path that merely starts like a probe is not one.
  await runMiddleware(middleware, { path: "/healthz", method: "GET", ip: "203.0.113.7" });
  expect(metrics.calls).toEqual(["ip/ip/allowed"]);
}

export async function assertStage1KeysTheClientBehindTheProxies(): Promise<void> {
  const { service } = limiter({ trustProxyHops: 2, ipLimits: { ip: 1, login: 10, ws: 1 } });
  const middleware = createClientIpLimitMiddleware(service);
  const via = (forwardedFor: string) =>
    runMiddleware(middleware, { path: "/api/v1/alarms", method: "GET", ip: "172.18.0.4", forwardedFor });
  expect((await via("203.0.113.7, 172.18.0.1")).nextCalled).toBe(true);
  // A forged prefix does not buy a new bucket.
  expect((await via("6.6.6.6, 203.0.113.7, 172.18.0.1")).res.statusCode).toBe(429);
  // Another real client does.
  expect((await via("203.0.113.8, 172.18.0.1")).nextCalled).toBe(true);
}

export function assertOnlyAPostToTheLoginPathIsALogin(): void {
  expect(isLoginRequest("POST", "/api/v1/auth/login")).toBe(true);
  expect(isLoginRequest("post", "/api/v1/auth/login/")).toBe(true);
  expect(isLoginRequest("POST", "/API/V1/AUTH/LOGIN")).toBe(true);
  expect(isLoginRequest("GET", "/api/v1/auth/login")).toBe(false);
  expect(isLoginRequest("POST", "/api/v1/auth/me")).toBe(false);
}

// ── Socket.IO handshake ─────────────────────────────────────────────────────

function fakeSocket(address: string, forwardedFor?: string) {
  return {
    handshake: { address, headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} },
    emitted: [] as Array<[string, unknown]>,
    disconnected: false,
    closedTheConnection: false,
    emit(event: string, body: unknown) {
      this.emitted.push([event, body]);
      return true;
    },
    disconnect(close?: boolean) {
      this.disconnected = true;
      this.closedTheConnection = close === true;
      return this;
    },
  };
}

export async function assertTheThirtyFirstHandshakeIsRefused(): Promise<void> {
  const { service } = limiter({ trustProxyHops: 2 });
  for (let i = 0; i < 30; i += 1) {
    const socket = fakeSocket("172.18.0.4", "203.0.113.7, 172.18.0.1");
    expect(await refuseRateLimitedHandshake(service, socket as never)).toBe(false);
    expect(socket.disconnected).toBe(false);
  }
  const refused = fakeSocket("172.18.0.4", "203.0.113.7, 172.18.0.1");
  expect(await refuseRateLimitedHandshake(service, refused as never)).toBe(true);
  expect(refused.disconnected).toBe(true);
  // The namespace only: closing the connection also drops the SPA's sibling
  // namespace on it (tests/f4.17-live-socket-multiplex.test.ts).
  expect(refused.closedTheConnection).toBe(false);
  expect(refused.emitted[0]?.[0]).toBe("rate_limited");
  expect(rateLimitedErrorSchema.parse(refused.emitted[0]?.[1]).code).toBe("rate_limited");
  // The bucket is the client behind the proxies, not nginx: another client is fine.
  const other = fakeSocket("172.18.0.4", "203.0.113.8, 172.18.0.1");
  expect(await refuseRateLimitedHandshake(service, other as never)).toBe(false);
}

export async function assertNoLimiterAdmitsEveryHandshake(): Promise<void> {
  expect(await refuseRateLimitedHandshake(undefined, fakeSocket("203.0.113.7") as never)).toBe(false);
}

// ── claimAll (the F3.47 shared window, ADR 0125 Q9) fails open ──────────────

export async function assertClaimAllReturnsTheScriptReply(): Promise<void> {
  const store = new RateLimitStore({ redis: fakeRedis(async () => 0) });
  expect(await store.claimAll(["k"], 30_000)).toBe(0);
  const held = new RateLimitStore({ redis: fakeRedis(async () => 12_000) });
  expect(await held.claimAll(["k"], 30_000)).toBe(12_000);
}

export async function assertClaimAllFailsOpenToNullAndCounts(): Promise<void> {
  const cases: Array<[string, RedisEvalClient]> = [
    ["no Redis configured", undefined as unknown as RedisEvalClient],
    ["not ready", fakeRedis(async () => 0, false)],
    ["eval throws", fakeRedis(async () => {
      throw new Error("ECONNRESET");
    })],
    ["a non-number reply", fakeRedis(async () => "OK")],
    ["a negative reply", fakeRedis(async () => -2)],
    ["NaN", fakeRedis(async () => Number.NaN)],
  ];
  for (const [why, redis] of cases) {
    const onStoreError = vi.fn();
    const store = new RateLimitStore({ redis: redis ?? null, onStoreError, timeoutMs: 10 });
    expect(await store.claimAll(["k"], 30_000), why).toBeNull();
    if (redis) {
      expect(onStoreError, why).toHaveBeenCalledTimes(1);
      expect(store.state, why).toBe("degraded");
    }
  }
  const slow = new RateLimitStore({ redis: fakeRedis(() => new Promise(() => undefined)), timeoutMs: 10 });
  expect(await slow.claimAll(["k"], 30_000)).toBeNull();
  // An empty key list is never sent: nothing to claim.
  const store = new RateLimitStore({ redis: fakeRedis(async () => 0) });
  expect(await store.claimAll([], 30_000)).toBeNull();
}
