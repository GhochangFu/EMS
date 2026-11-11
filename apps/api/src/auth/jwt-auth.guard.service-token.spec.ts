import { ForbiddenException, HttpException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { expect, vi } from "vitest";

import type { BmsDb } from "@bms/db";

import { readRateLimitConfig } from "../rate-limit/rate-limit-config";
import { RateLimitStore } from "../rate-limit/rate-limit-store";
import { RateLimiterService } from "../rate-limit/rate-limiter.service";
import type { ServicePrincipal, ServiceTokenVerifier } from "../service-accounts/service-token-verifier.service";
import { recalledIdentity } from "./identity-resolver";
import { JwtAuthGuard, serviceTokenOf } from "./jwt-auth.guard";

/**
 * `F4.17` / ADR 0125 decisions 1, 11 and 12 — the guard's `bms_sat_` path,
 * over a stubbed verifier (the verifier itself is `service-token.spec.ts`).
 */

const ACCOUNT = "00000000-0000-4000-8000-0000000000f1";
const TOKEN_A = `bms_sat_AAAAAAAAAAAA_${"a".repeat(43)}`;
const TOKEN_B = `bms_sat_BBBBBBBBBBBB_${"b".repeat(43)}`;

function principalFor(tokenId: string, readOnly = false): ServicePrincipal {
  return {
    payload: { sub: ACCOUNT, email: "svc-1@service-account.invalid", name: "Integration", role: "operator" },
    identity: {
      id: ACCOUNT,
      email: "svc-1@service-account.invalid",
      displayName: "Integration",
      role: "operator",
      organizationId: "00000000-0000-4000-8000-0000000000d1",
      oidcSubject: null,
      disabledAt: null,
      kind: "service",
    },
    tokenId,
    readOnly,
    expiresAt: Date.UTC(2027, 0, 1),
  };
}

function verifierAnswering(answer: (token: string) => ServicePrincipal | null) {
  const verify = vi.fn(async (token: string) => answer(token));
  return { verify, verifier: { verify } as unknown as ServiceTokenVerifier };
}

const authDbNeverRead = {
  select: () => {
    throw new Error("the token path must not read users by JWT subject");
  },
} as unknown as BmsDb;

function context(method: string, authorization: string) {
  const req: { method: string; headers: { authorization: string }; user?: unknown } = {
    method,
    headers: { authorization },
  };
  const res = { headers: {} as Record<string, string>, setHeader(n: string, v: string) { res.headers[n] = v; } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => function handler() {},
    getClass: () => class Routes {},
  } as unknown as ExecutionContext;
  return { ctx, req };
}

export async function assertAValidTokenAuthenticatesAsItsServiceAccount(): Promise<void> {
  const jwt = new JwtService({ secret: "x" });
  const jwtVerify = vi.spyOn(jwt, "verify");
  const { verifier, verify } = verifierAnswering((t) => (t === TOKEN_A ? principalFor("AAAAAAAAAAAA") : null));
  const guard = new JwtAuthGuard(jwt, authDbNeverRead, undefined, verifier);
  const { ctx, req } = context("GET", `Bearer ${TOKEN_A}`);
  expect(await guard.canActivate(ctx)).toBe(true);
  expect(req.user).toEqual(principalFor("AAAAAAAAAAAA").payload);
  // The identity memo the rest of the request reads, and the token facts.
  expect(recalledIdentity(req.user as { sub: string })?.kind).toBe("service");
  expect(serviceTokenOf(req.user as object)).toEqual({
    tokenId: "AAAAAAAAAAAA",
    readOnly: false,
    expiresAt: Date.UTC(2027, 0, 1),
  });
  expect(verify).toHaveBeenCalledWith(TOKEN_A);
  // A token never reaches the JWT path.
  expect(jwtVerify).not.toHaveBeenCalled();
}

export async function assertAnyRefusedTokenIsTheOneGeneric401(): Promise<void> {
  const { verifier } = verifierAnswering(() => null);
  const guard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead, undefined, verifier);
  const { ctx } = context("GET", `Bearer ${TOKEN_A}`);
  const err = await guard.canActivate(ctx).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UnauthorizedException);
  expect((err as HttpException).getResponse()).toEqual({
    statusCode: 401,
    message: "Invalid token",
    error: "Unauthorized",
    code: "token_invalid",
  });
}

export async function assertWithoutAVerifierATokenIsRefusedNotAccepted(): Promise<void> {
  const guard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead);
  const { ctx } = context("GET", `Bearer ${TOKEN_A}`);
  const err = await guard.canActivate(ctx).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UnauthorizedException);
  // The token path's own refusal, not a JWT parse failure that also happens to 401.
  expect((err as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "token_invalid" }));
}

export async function assertAJwtNeverReachesTheVerifier(): Promise<void> {
  const { verifier, verify } = verifierAnswering(() => principalFor("AAAAAAAAAAAA"));
  const guard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead, undefined, verifier);
  const { ctx } = context("GET", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.bad");
  await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  expect(verify).not.toHaveBeenCalled();
}

export async function assertAReadOnlyTokenReadsAndIsRefusedEveryWrite(): Promise<void> {
  const { verifier } = verifierAnswering(() => principalFor("AAAAAAAAAAAA", true));
  const guard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead, undefined, verifier);
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    expect(await guard.canActivate(context(method, `Bearer ${TOKEN_A}`).ctx), method).toBe(true);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const err = await guard.canActivate(context(method, `Bearer ${TOKEN_A}`).ctx).catch((e: unknown) => e);
    expect(err, method).toBeInstanceOf(ForbiddenException);
    expect((err as HttpException).getResponse()).toEqual(expect.objectContaining({ code: "token_read_only" }));
  }
  // A read-write token of the same account writes.
  const rw = verifierAnswering(() => principalFor("BBBBBBBBBBBB", false));
  const rwGuard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead, undefined, rw.verifier);
  expect(await rwGuard.canActivate(context("POST", `Bearer ${TOKEN_B}`).ctx)).toBe(true);
}

export async function assertEachTokenHasItsOwnStage2Budget(): Promise<void> {
  const config = { ...readRateLimitConfig({ RATE_LIMIT_MODE: "enforce" }), classLimits: { read: 1, write: 1, heavy: 1 } };
  const limiter = new RateLimiterService(config, new RateLimitStore({ redis: null }), null);
  const { verifier } = verifierAnswering((t) =>
    t === TOKEN_A ? principalFor("AAAAAAAAAAAA") : principalFor("BBBBBBBBBBBB"),
  );
  const guard = new JwtAuthGuard(new JwtService({ secret: "x" }), authDbNeverRead, limiter, verifier);
  expect(await guard.canActivate(context("GET", `Bearer ${TOKEN_A}`).ctx)).toBe(true);
  // The same account's other token is a separate budget: one leaked token cannot drain it.
  expect(await guard.canActivate(context("GET", `Bearer ${TOKEN_B}`).ctx)).toBe(true);
  const err = await guard.canActivate(context("GET", `Bearer ${TOKEN_A}`).ctx).catch((e: unknown) => e);
  expect((err as HttpException).getStatus()).toBe(429);
}
