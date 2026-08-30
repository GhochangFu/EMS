import { readFileSync } from "node:fs";
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
 * **Neither substitutes for the other, and swapping them is a silent hole.** A
 * read that used `withTenant` would still be correct but would stop being
 * checked against the caller's asset scope; a roll-up that used the fleet pool
 * would sweep every organization's rules at once and nothing would fail. Both
 * directions are asserted below, because the failure in each case is an absence.
 *
 * Assertions inline, no `.spec` sibling — §4.6 carves out the top-level `tests/`
 * directory for repo-wide invariants.
 */
const CONTROLLER_REL = "apps/api/src/asset-health/asset-health.controller.ts";
const READ_SERVICE_REL = "apps/api/src/asset-health/asset-health.service.ts";
const ROLLUP_SERVICE_REL = "apps/api/src/asset-health/health-rollup.service.ts";

/** Comments stripped: these files explain the rules they follow, so a
 * `toContain` against the raw text would pass on a docblock alone. `f3.1a`
 * learned this when `RESET ROLE;` in a comment kept a deleted statement green. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("E1.3 health containment (ADR 0050 decision 8, ADR 0048's telemetry model)", () => {
  it("guards every route on the health controller before it reads", () => {
    const code = codeOnly(read(CONTROLLER_REL));

    // Every `@Get` must be matched by an access check. Counting rather than
    // spot-checking: a route added later is the failure mode, and it would pass
    // any assertion written against the two routes that exist today.
    const routes = code.match(/@Get\(/g) ?? [];
    expect(routes.length, "the controller must expose at least the two E1.3 routes").toBeGreaterThan(
      1,
    );

    const checks =
      (code.match(/canReadAsset\(/g) ?? []).length +
      (code.match(/readableAssetIds\(/g) ?? []).length;
    expect(
      checks,
      "every @Get on asset-health must call canReadAsset or readableAssetIds — " +
        "telemetry.* has no RLS, so this guard is the only containment there is",
    ).toBeGreaterThanOrEqual(routes.length);

    expect(code, "the controller must be behind JwtAuthGuard").toContain("@UseGuards(JwtAuthGuard)");
  });

  it("keeps the read on the fleet pool and the roll-up on the tenant pool", () => {
    const readService = codeOnly(read(READ_SERVICE_REL));
    const rollup = codeOnly(read(ROLLUP_SERVICE_REL));

    // The read is guard-contained, so it uses the fleet pool and must NOT
    // silently acquire a second containment mechanism that hides the first.
    expect(readService).toContain("FLEET_DRIZZLE");
    expect(
      readService,
      "the read is contained by the controller's guard, not by withTenant — " +
        "adding withTenant here would mask a missing guard rather than replace it",
    ).not.toContain("withTenant");

    // The roll-up has no request to authorize, so withTenant is the ONLY thing
    // scoping it. Without it, `bms.automation_rules`' forced policies never
    // engage and one sweep reads every tenant's rules.
    expect(
      rollup,
      "the roll-up must sweep inside withTenant (ADR 0050 decision 8)",
    ).toContain("withTenant(");
    expect(rollup).toContain("TENANT_DRIZZLE");
  });

  it("confines the fleet pool in the roll-up to enumerating organizations", () => {
    // `bms_fleet` is BYPASSRLS. The roll-up needs it exactly once, because a
    // tenant-role connection can only see the tenant it has already named — so
    // something must know the list. Any SECOND use would cross every tenant
    // boundary at once, and nothing would fail: no error, no empty result, just
    // one organization's rules applied to another's telemetry.
    const rollup = codeOnly(read(ROLLUP_SERVICE_REL));
    const fleetUses = rollup.match(/this\.fleetDb\b/g) ?? [];
    expect(
      fleetUses.length,
      `this.fleetDb is used ${fleetUses.length} times; it may be used once, to list ` +
        "organization ids. bms_fleet is BYPASSRLS — a second query here reads every tenant.",
    ).toBe(1);
  });

  it("does not let the health module reach for the owner or superuser URL", () => {
    // ADR 0043 decision 8: the API holds no owner connection at all. A service
    // reaching for `DATABASE_URL` would run as `bms_owner`, for which
    // `FORCE ROW LEVEL SECURITY` is the only restraint — and `telemetry.*` has
    // no policy to force.
    for (const rel of [READ_SERVICE_REL, ROLLUP_SERVICE_REL, CONTROLLER_REL]) {
      const code = codeOnly(read(rel));
      expect(code, `${rel} must not name an owner or superuser connection URL`).not.toMatch(
        /DATABASE_URL_SUPERUSER|DATABASE_URL\b/,
      );
    }
  });
});
