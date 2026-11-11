import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.17` / ADR 0125 decisions 11–13 — the wiring no unit spec can see. The
 * guard takes the token verifier as `@Optional()` (so a spec builds it by
 * hand), which fails *closed* when the module is missing — a `bms_sat_` token
 * is refused — but would leave every integration silently unable to sign in.
 * These pin the module, the guard's route, the gateways' socket tag and the
 * revoke listener. Comment-stripped.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const code = (rel: string): string =>
  readFileSync(join(repoRoot, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("F4.17 — service-account tokens are wired where ADR 0125 puts them", () => {
  it("AppModule imports the global ServiceAccountsModule, which exports the verifier", () => {
    expect(code("apps/api/src/app.module.ts")).toMatch(/imports:\s*\[[\s\S]*\bServiceAccountsModule\b/);
    const module = code("apps/api/src/service-accounts/service-accounts.module.ts");
    expect(module).toMatch(/@Global\(\)\s*@Module/);
    expect(module).toMatch(/exports:\s*\[[^\]]*\bServiceTokenVerifier\b/);
    expect(module).toMatch(/providers:\s*\[[^\]]*\bServiceTokenListenerService\b/);
  });

  it("the worker does not import ServiceAccountsModule", () => {
    expect(code("apps/api/src/worker.module.ts")).not.toMatch(/ServiceAccountsModule/);
  });

  it("verifyToken routes a bms_sat_ token before any JWT parse", () => {
    const guard = code("apps/api/src/auth/jwt-auth.guard.ts");
    const route = guard.indexOf("if (looksLikeServiceToken(token)) {");
    const jwt = guard.indexOf('const oidc = authMode() === "oidc";');
    expect(route).toBeGreaterThan(-1);
    expect(jwt).toBeGreaterThan(route);
    expect(guard).toMatch(/@Optional\(\) private readonly serviceTokenVerifier\?: ServiceTokenVerifier/);
  });

  it("canActivate refuses a read-only token's write before the Stage 2 limit", () => {
    const guard = code("apps/api/src/auth/jwt-auth.guard.ts");
    const verify = guard.indexOf("req.user = await this.verifyToken(token);");
    const readOnly = guard.indexOf("this.refuseWriteByReadOnlyToken(req, req.user);");
    const stage2 = guard.indexOf("await this.enforceIdentityLimit(context, req, req.user);");
    expect(verify).toBeGreaterThan(-1);
    expect(readOnly).toBeGreaterThan(verify);
    expect(stage2).toBeGreaterThan(readOnly);
  });

  it.each(["apps/api/src/telemetry/telemetry.gateway.ts", "apps/api/src/alarms/alarms.gateway.ts"])(
    "%s tags a token's socket so a revoke can close it",
    (rel) => {
      expect(code(rel)).toMatch(/client\.data\.serviceTokenId = serviceTokenOf\(payload\)\?\.tokenId;/);
    },
  );
});
