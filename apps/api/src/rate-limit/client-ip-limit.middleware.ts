import type { NextFunction, Request, Response } from "express";

import { GLOBAL_PREFIX } from "../global-prefix";
import { clientAddress } from "./rate-limit-key";
import type { RateLimiterService } from "./rate-limiter.service";
import { rateLimitedBody, rateLimitedHeaders } from "./rate-limited.exception";

/**
 * `F4.17` / ADR 0125 decisions 1 and 2 — **Stage 1**, per client IP, as
 * Express middleware registered in `main.ts` before the Nest router. It runs
 * before any guard, pipe or multer buffer, so it covers the routes no guard
 * protects (`POST /auth/login`, `/public/appearance`, the docs).
 *
 * **Every path is counted except the three probes** — `/health`,
 * `/health/ready` and `/metrics` — so an orchestrator can never be refused.
 * The test is "not exempt" rather than "starts with `/api/v1/`" because
 * Express matches routes **case-insensitively**: a prefix test let
 * `/api/V1/auth/login` reach the login handler uncounted (security review,
 * H1). For the same reason both tests compare a lower-cased path with its
 * trailing slashes removed. `POST /api/v1/auth/login` is counted twice — in
 * the shared `ip` bucket and in its own, much smaller `login` bucket.
 *
 * The client address comes from `clientAddress` over the socket peer and
 * `X-Forwarded-For` (decision 8), not from `req.ip`: a chain shorter than the
 * hop count is keyed on the socket peer rather than on an entry the client
 * wrote (security review, M2). The refusal is written here directly, so it
 * bypasses Nest's exception filters; its body comes from the same helper the
 * guard uses.
 */

const EXEMPT_PATHS = new Set(["/health", "/health/ready", "/metrics"]);
const LOGIN_PATH = `/${GLOBAL_PREFIX}/auth/login`;

function normalisedPath(path: string): string {
  const lower = path.toLowerCase().replace(/\/+$/, "");
  return lower === "" ? "/" : lower;
}

export function isRateLimitedPath(path: string): boolean {
  return !EXEMPT_PATHS.has(normalisedPath(path));
}

export function isLoginRequest(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && normalisedPath(path) === LOGIN_PATH;
}

export function createClientIpLimitMiddleware(limiter: RateLimiterService) {
  return function clientIpLimit(req: Request, res: Response, next: NextFunction): void {
    if (limiter.mode === "off" || !isRateLimitedPath(req.path)) {
      next();
      return;
    }
    const address = clientAddress(
      req.socket.remoteAddress,
      req.headers["x-forwarded-for"],
      limiter.config.trustProxyHops,
    );
    void (async () => {
      const ipDecision = await limiter.checkIp("ip", address);
      const decision =
        !ipDecision.refuse && isLoginRequest(req.method, req.path)
          ? await limiter.checkIp("login", address)
          : ipDecision;
      if (decision.refuse) {
        res.set(rateLimitedHeaders(decision.refusal));
        res.status(429).json(rateLimitedBody(decision.refusal));
        return;
      }
      next();
    })().catch(next);
  };
}
