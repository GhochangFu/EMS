import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.3` — the two containment mechanisms, pinned separately.
 *
 * ADR 0050 gives the health feature two halves that reach the same tables by
 * two different routes, and each is contained by a different thing:
 *
 * - **The read** answers a request, so it is contained by the controller's
 *   `AccessControlService` guard. `telemetry.*` carries no Row Level Security
 *   (ADR 0043), so no pool filters the counter relations and that guard is the
 *   only boundary — ADR 0048's Consequences say exactly this about the
 *   neighbouring aggregate endpoint.
 * - **The roll-up** has no request to authorize, so it is contained by
 *   `withTenant` on the tenant role (ADR 0050 decision 8), which is what makes
 *   `bms.automation_rules`' forced policies apply to it.
 *
 * **Neither substitutes for the other, and swapping them is a silent hole.**
 *
 * ## What this file can and cannot see, after the E1.3 review
 *
 * The first version of this file counted call sites across three hard-coded
 * paths, and three reviewers independently listed mutations that survived it:
 * a handler could call the guard and then discard its result; a fourth route
 * could be a `@Post` the regex never matched; a second controller file was
 * matched by nothing; and one handler calling `canReadAsset` twice paid for
 * another handler calling it zero times.
 *
 * **A source scan cannot fix the first of those, and this file no longer
 * pretends to.** That the value returned by `readableAssetIds` is the value
 * handed to the service is a behavioural fact, and it is asserted in
 * `apps/api/src/asset-health/asset-health.controller.spec.ts` with a stubbed
 * `AccessControlService`. What is left here is the half only a scan can do:
 * enumerate the whole directory so a NEW file cannot arrive unnoticed, pair
 * each route with a guard **inside its own handler body**, and forbid the two
 * pool misuses that have no runtime symptom at all.
 *
 * Assertions inline, no `.spec` sibling — §4.6 carves out the top-level `tests/`
 * directory for repo-wide invariants.
 */
const MODULE_DIR = "apps/api/src/asset-health";
const READ_SERVICE_REL = `${MODULE_DIR}/asset-health.service.ts`;
const ROLLUP_SERVICE_REL = `${MODULE_DIR}/health-rollup.service.ts`;

/** Comments stripped: these files explain the rules they follow, so a
 * `toContain` against the raw text would pass on a docblock alone. `f3.1a`
 * learned this when `RESET ROLE;` in a comment kept a deleted statement green. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every non-test source file in the module, so a new one is in scope by
 * default rather than by someone remembering to add it here. */
const moduleSources = (): string[] =>
  readdirSync(join(repoRoot, MODULE_DIR))
    .filter((name) => name.endsWith(".ts") && !name.includes(".spec.") && !name.includes(".test."))
    .map((name) => `${MODULE_DIR}/${name}`);

/** Every Nest HTTP verb, not just `@Get`. A `@Post` route was invisible before. */
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|All)\s*\(/g;

describe("E1.3 health containment (ADR 0050 decision 8, ADR 0048's telemetry model)", () => {
  it("guards every route in the module, in the handler's own body", () => {
    const controllers = moduleSources().filter((rel) => rel.endsWith(".controller.ts"));
    expect(controllers.length, "the module must expose at least one controller").toBeGreaterThan(0);

    for (const rel of controllers) {
      const code = codeOnly(read(rel));
      expect(code, `${rel} must sit behind JwtAuthGuard`).toContain("@UseGuards(JwtAuthGuard)");

      // Split on the route decorators so each handler is checked against its OWN
      // guard. Counting per file let one handler's two checks pay for another
      // handler's none — the defect the correctness review named.
      const segments = code.split(ROUTE_DECORATOR).slice(1);
      // `split` with a capturing group interleaves the verb and the body.
      const bodies = segments.filter((_, index) => index % 2 === 1);
      expect(bodies.length, `${rel} declares no routes; the regex has drifted`).toBeGreaterThan(0);

      for (const body of bodies) {
        const handler = body.slice(0, body.search(/\n  @|\n}/) + 1 || body.length);
        expect(
          /canReadAsset\(|readableAssetIds\(/.test(handler),
          `a route in ${rel} reaches its service with no access check in its own body. ` +
            "telemetry.* has no RLS, so this guard is the only containment there is:\n" +
            handler.slice(0, 400),
        ).toBe(true);
      }
    }
  });

  it("keeps the read on the fleet pool and the roll-up on the tenant pool", () => {
    const readService = codeOnly(read(READ_SERVICE_REL));
    const rollup = codeOnly(read(ROLLUP_SERVICE_REL));

    expect(readService).toContain("FLEET_DRIZZLE");
    expect(
      readService,
      "the read is contained by the controller's guard, not by withTenant — " +
        "adding withTenant here would mask a missing guard rather than replace it",
    ).not.toContain("withTenant");

    expect(rollup, "the roll-up must sweep inside withTenant (ADR 0050 decision 8)").toContain(
      "withTenant(",
    );
    expect(rollup).toContain("TENANT_DRIZZLE");
  });

  it("never reaches the tenant handle outside a withTenant bracket", () => {
    // The security review's mutation: move `tx.execute(...)` out of the callback
    // to `this.tenantDb.execute(...)`. The string `withTenant(` survives, so the
    // previous assertion stayed green while the `SET LOCAL` no longer covered
    // the statement — and with no RLS on `telemetry.*` the write would simply
    // succeed, unscoped, with no error anywhere.
    //
    // `withTenant` is the ONLY legal mention of the handle.
    const rollup = codeOnly(read(ROLLUP_SERVICE_REL));
    const uses = rollup.match(/this\.tenantDb\b/g) ?? [];
    expect(
      uses.length,
      `this.tenantDb is used ${uses.length} times; it may be used once, as withTenant's ` +
        "first argument. Any other use runs outside the SET LOCAL that scopes it.",
    ).toBe(1);
    expect(
      /withTenant\(\s*this\.tenantDb\b/.test(rollup),
      "the single tenantDb use must be withTenant's own argument",
    ).toBe(true);
  });

  it("confines every BYPASSRLS handle in the roll-up to enumerating organizations", () => {
    // `bms_fleet` is BYPASSRLS. The roll-up needs it exactly once, because a
    // tenant-role connection can only see the tenant it has already named — so
    // something must know the list. Any SECOND use would cross every tenant
    // boundary at once, and nothing would fail: no error, no empty result, just
    // one organization's rules applied to another's telemetry.
    //
    // Counting `this.fleetDb` alone was escapable three ways, all named by the
    // security review: aliasing it to a local, destructuring it, or injecting
    // the separate `FLEET_POOL` token for a second query. This counts the
    // property, forbids the aliases, and forbids the second token outright.
    const rollup = codeOnly(read(ROLLUP_SERVICE_REL));

    const fleetUses = rollup.match(/this\.fleetDb\b/g) ?? [];
    expect(
      fleetUses.length,
      `this.fleetDb is used ${fleetUses.length} times; it may be used once, to list ` +
        "organization ids. bms_fleet is BYPASSRLS — a second query here reads every tenant.",
    ).toBe(1);

    expect(
      /(?:const|let)\s*\{[^}]*\bfleetDb\b[^}]*\}\s*=\s*this\b/.test(rollup),
      "destructuring fleetDb off `this` hides further uses from the count above",
    ).toBe(false);
    expect(
      /(?:const|let)\s+\w+\s*=\s*this\.fleetDb\b/.test(rollup),
      "aliasing this.fleetDb to a local hides further uses from the count above",
    ).toBe(false);
    expect(
      rollup,
      "FLEET_POOL is a second BYPASSRLS handle; one query through it would be invisible " +
        "to the this.fleetDb count",
    ).not.toContain("FLEET_POOL");
  });
});
