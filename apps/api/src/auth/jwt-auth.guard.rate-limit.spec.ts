import { HttpException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { expect } from "vitest";

import type { BmsDb } from "@bms/db";
import { rateLimitedErrorSchema } from "@bms/shared";

import { RateLimitClassOf } from "../rate-limit/rate-limit-class.decorator";
import { readRateLimitConfig, type RateLimitConfig } from "../rate-limit/rate-limit-config";
import { RateLimitStore } from "../rate-limit/rate-limit-store";
import { RateLimiterService } from "../rate-limit/rate-limiter.service";
import type { ResolvedIdentity } from "./identity-resolver";
import { JwtAuthGuard } from "./jwt-auth.guard";

/**
 * `F4.17` / ADR 0125 decisions 1, 2 and 5 — **Stage 2** at the end of
 * `JwtAuthGuard.canActivate`, under local `AUTH_MODE` (the token path is not
 * what is under test; `jwt-auth.guard.spec.ts` owns it).
 *
 * The subject is the resolved `bms.users.id`. The two-user case is the one
 * that gates it: a guard that keyed every caller on one constant would pass
 * every single-user case here.
 */

const SECRET = "f4.17-guard-spec-secret";
const jwt = new JwtService({ secret: SECRET });

function row(id: string): ResolvedIdentity {
  return {
    id,
    email: `${id}@bms.local`,
    displayName: id,
    role: "viewer",
    organizationId: "00000000-0000-4000-8000-0000000000d1",
    oidcSubject: null,
    disabledAt: null,
  };
}

const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b1";

/** The auth pool: answers each select with the row whose id the token named. */
function authDb(rows: Record<string, ResolvedIdentity | undefined>): BmsDb {
  let lastSub = "";
  const select = () => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => {
        const found = rows[lastSub];
        return found ? [found] : [];
      },
    };
    return chain;
  };
  return {
    select,
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
    // The guard reads the subject from the token; the fake learns it here.
    set lastSubject(sub: string) {
      lastSub = sub;
    },
  } as unknown as BmsDb;
}

function token(sub: string): string {
  return jwt.sign({ sub, email: `${sub}@bms.local`, name: sub, role: "viewer" });
}

class Routes {
  read(): void {}

  @RateLimitClassOf("heavy")
  upload(): void {}
}

type Captured = { headers: Record<string, string> };

function context(
  method: string,
  authorization: string | undefined,
  handler: () => void = Routes.prototype.read,
): { ctx: ExecutionContext; res: Captured } {
  const res: Captured & { setHeader(name: string, value: string): void } = {
    headers: {},
    setHeader(name, value) {
      res.headers[name] = value;
    },
  };
  const req = { method, headers: authorization ? { authorization } : {} };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => Routes,
  } as unknown as ExecutionContext;
  return { ctx, res };
}

function limiter(overrides: Partial<RateLimitConfig>): RateLimiterService {
  const config = { ...readRateLimitConfig({ RATE_LIMIT_MODE: "enforce" }), ...overrides };
  return new RateLimiterService(config, new RateLimitStore({ redis: null }), null);
}

function guard(service: RateLimiterService | undefined): { guard: JwtAuthGuard; db: BmsDb } {
  const db = authDb({ [USER_A]: row(USER_A), [USER_B]: row(USER_B) });
  return { guard: new JwtAuthGuard(jwt, db, service), db };
}

async function withLocalMode(fn: () => Promise<void>): Promise<void> {
  const saved = { AUTH_MODE: process.env.AUTH_MODE, OIDC_ISSUER: process.env.OIDC_ISSUER };
  process.env.AUTH_MODE = "local";
  delete process.env.OIDC_ISSUER;
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function call(
  subject: { guard: JwtAuthGuard; db: BmsDb },
  sub: string,
  method = "GET",
  handler?: () => void,
): Promise<{ outcome: "allowed" | HttpException; res: Captured }> {
  (subject.db as unknown as { lastSubject: string }).lastSubject = sub;
  const { ctx, res } = context(method, `Bearer ${token(sub)}`, handler);
  try {
    await subject.guard.canActivate(ctx);
    return { outcome: "allowed", res };
  } catch (err) {
    if (err instanceof HttpException) {
      return { outcome: err, res };
    }
    throw err;
  }
}

export async function assertTheHitAfterTheReadLimitIsA429WithItsHeaders(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(limiter({ classLimits: { read: 2, write: 100, heavy: 100 } }));
    expect((await call(subject, USER_A)).outcome).toBe("allowed");
    expect((await call(subject, USER_A)).outcome).toBe("allowed");
    const { outcome, res } = await call(subject, USER_A);
    expect(outcome).toBeInstanceOf(HttpException);
    const refused = outcome as HttpException;
    expect(refused.getStatus()).toBe(429);
    expect(rateLimitedErrorSchema.parse(refused.getResponse()).retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(res.headers["Retry-After"]).toMatch(/^\d+$/);
    expect(res.headers["RateLimit-Policy"]).toBe('"read";q=2;w=60');
  });
}

export async function assertTwoUsersHaveTwoBudgets(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(limiter({ classLimits: { read: 1, write: 100, heavy: 100 } }));
    expect((await call(subject, USER_A)).outcome).toBe("allowed");
    expect((await call(subject, USER_B)).outcome).toBe("allowed");
    expect((await call(subject, USER_A)).outcome).not.toBe("allowed");
  });
}

export async function assertAWriteCountsInTheWriteClass(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(limiter({ classLimits: { read: 100, write: 1, heavy: 100 } }));
    expect((await call(subject, USER_A, "POST")).outcome).toBe("allowed");
    expect((await call(subject, USER_A, "GET")).outcome).toBe("allowed");
    const refused = await call(subject, USER_A, "DELETE");
    expect((refused.outcome as HttpException).getStatus()).toBe(429);
  });
}

export async function assertAHeavyRouteUsesTheHeavyLimit(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(limiter({ classLimits: { read: 100, write: 100, heavy: 1 } }));
    expect((await call(subject, USER_A, "POST", Routes.prototype.upload)).outcome).toBe("allowed");
    const refused = await call(subject, USER_A, "POST", Routes.prototype.upload);
    expect((refused.outcome as HttpException).getStatus()).toBe(429);
    expect(refused.res.headers["RateLimit-Policy"]).toBe('"heavy";q=1;w=60');
    // A plain write by the same user still has its own budget.
    expect((await call(subject, USER_A, "POST")).outcome).toBe("allowed");
  });
}

export async function assertAMissingTokenSpendsNoBudget(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(limiter({ classLimits: { read: 1, write: 100, heavy: 100 } }));
    for (let i = 0; i < 3; i += 1) {
      const { ctx } = context("GET", undefined);
      await expect(subject.guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect((await call(subject, USER_A)).outcome).toBe("allowed");
  });
}

export async function assertShadowNeverRefuses(): Promise<void> {
  await withLocalMode(async () => {
    const service = limiter({ mode: "shadow", classLimits: { read: 1, write: 1, heavy: 1 } });
    (service as unknown as { logger: { warn: () => void } }).logger.warn = () => undefined;
    const subject = guard(service);
    for (let i = 0; i < 5; i += 1) {
      expect((await call(subject, USER_A)).outcome).toBe("allowed");
    }
  });
}

export async function assertNoLimiterMeansNoStage2(): Promise<void> {
  await withLocalMode(async () => {
    const subject = guard(undefined);
    for (let i = 0; i < 5; i += 1) {
      expect((await call(subject, USER_A)).outcome).toBe("allowed");
    }
  });
}
