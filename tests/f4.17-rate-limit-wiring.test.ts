import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125 — the wiring no unit spec can see. The guard and both
 * gateways take the limiter as an `@Optional()` dependency (so a spec can
 * build them by hand), which means a missing `RateLimitModule` import would
 * silently turn Stage 2 and the handshake check off. These pin the imports
 * and the call sites, comment-stripped.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function code(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("F4.17 — the limiter is wired where ADR 0125 puts it", () => {
  it("AppModule imports RateLimitModule, and the module is @Global", () => {
    expect(code("apps/api/src/app.module.ts")).toMatch(/imports:\s*\[[\s\S]*\bRateLimitModule\b/);
    expect(code("apps/api/src/rate-limit/rate-limit.module.ts")).toMatch(/@Global\(\)\s*@Module/);
    // `main.ts`'s `app.get` resolves an unexported provider, so only the export
    // keeps the guard, the gateways and health from receiving `undefined`.
    expect(code("apps/api/src/rate-limit/rate-limit.module.ts")).toMatch(/exports:\s*\[[^\]]*\bRateLimiterService\b/);
  });

  it("the worker does not import RateLimitModule", () => {
    expect(code("apps/api/src/worker.module.ts")).not.toMatch(/RateLimitModule/);
  });

  it("JwtAuthGuard.canActivate runs Stage 2 after verifyToken", () => {
    const guard = code("apps/api/src/auth/jwt-auth.guard.ts");
    const verify = guard.indexOf("req.user = await this.verifyToken(token);");
    const stage2 = guard.indexOf("await this.enforceIdentityLimit(context, req, req.user);");
    expect(verify).toBeGreaterThan(-1);
    expect(stage2).toBeGreaterThan(verify);
    expect(guard).toMatch(/@Optional\(\) private readonly rateLimiter\?: RateLimiterService/);
  });

  it.each(["apps/api/src/telemetry/telemetry.gateway.ts", "apps/api/src/alarms/alarms.gateway.ts"])(
    "%s checks the handshake before it reads the token",
    (rel) => {
      const gateway = code(rel);
      const check = gateway.indexOf("await refuseRateLimitedHandshake(this.rateLimiter, client)");
      const token = gateway.indexOf("this.extractToken(client)");
      expect(check).toBeGreaterThan(-1);
      expect(token).toBeGreaterThan(check);
    },
  );

  it("main.ts sets trust proxy and registers Stage 1 after enableCors", () => {
    const main = code("apps/api/src/main.ts");
    const cors = main.indexOf("app.enableCors(");
    const trust = main.indexOf('app.set("trust proxy", rateLimiter.config.trustProxyHops);');
    const stage1 = main.indexOf("app.use(createClientIpLimitMiddleware(rateLimiter));");
    expect(cors).toBeGreaterThan(-1);
    expect(trust).toBeGreaterThan(cors);
    expect(stage1).toBeGreaterThan(trust);
  });
});
