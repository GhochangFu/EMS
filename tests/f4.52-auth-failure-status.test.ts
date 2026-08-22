import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skipDirs = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * `F4.52` — an authentication failure must never reach the client as a 403.
 *
 * `clearSessionOnAuthFailure` (`apps/web/src/api/http.ts`) clears the local
 * session on **401 only**. It used to clear on 403 as well, which logged a
 * user out of a valid session every time they were refused and discarded
 * whatever they had typed.
 *
 * That narrowing is correct only while **no 403 is repairable by
 * re-authentication**. A 403 raised for a bad, missing or expired token would
 * leave the app rendering "you may not do this" over a session the API has
 * already stopped accepting — a screen that never recovers, which is strictly
 * worse than the logout the fix removed.
 *
 * The premise lived in a docblock until the `F4.52` security and compliance
 * reviews independently made the same point: `tests/repo-invariants.test.ts`
 * exists because an artefact that looks authoritative while nothing executes
 * it is this repository's recurring failure. A prose invariant is exactly
 * that. This file makes it a gate.
 *
 * It lives here rather than in `repo-invariants.test.ts` only because adding
 * it there pushed that file past the AGENTS.md §4.5 1000-line cap.
 *
 * **One real exception is worth knowing before reading a failure here.**
 * `audit.service.ts` throws a 403 for a valid, verified token whose subject
 * matches no `users` row ("this token matches no user"). That is a 403 with no
 * principal — and it argues *for* this behaviour rather than against it, since
 * signing in again cannot provision an account, so clearing the session there
 * would produce a login loop. The invariant is about repair, not about
 * principals.
 */
describe("F4.52 — authentication failures stay 401", () => {
  it("the JWT guard rejects tokens with 401 and never 403", () => {
    const source = readFileSync(join(repoRoot, "apps/api/src/auth/jwt-auth.guard.ts"), "utf8");

    // Positive control. Without it, deleting every throw from the guard would
    // satisfy the real assertion below and this check would pass over a file
    // that rejects nothing.
    expect(
      /throw new UnauthorizedException\(/.test(source),
      "jwt-auth.guard.ts no longer throws UnauthorizedException, so this file is " +
        "asserting the absence of a 403 in a guard that rejects nothing. Fix the " +
        "control before trusting the assertion.",
    ).toBe(true);

    expect(
      /ForbiddenException/.test(source),
      "jwt-auth.guard.ts now references ForbiddenException. Authentication failures " +
        "must stay 401: apps/web/src/api/http.ts clears the session on 401 only, so a " +
        "403 raised for a bad, missing or expired token would strand the user on a " +
        "screen that cannot recover. Throw UnauthorizedException, or reopen F4.52 " +
        "before changing this.",
    ).toBe(false);
  });

  it("no global guard or exception filter can remap a status", () => {
    // The check above reads one file. A global guard returning `false` makes
    // Nest synthesise a 403, and an exception filter can rewrite any status —
    // either would break the invariant without touching `jwt-auth.guard.ts`,
    // so the check above would keep passing while the premise stopped holding.
    const apiSrc = join(repoRoot, "apps", "api", "src");
    const offenders = walk(apiSrc)
      .filter((f) => f.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(f))
      .filter((f) =>
        /APP_GUARD|APP_FILTER|useGlobalGuards|useGlobalFilters|implements ExceptionFilter/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => relative(repoRoot, f).split(sep).join("/"));

    expect(
      offenders,
      `a global guard or exception filter was added: ${offenders.join(", ")}. Either ` +
        "can turn an authentication failure into a 403 without changing " +
        "jwt-auth.guard.ts, which is the only file the sibling check reads. Confirm " +
        "it cannot produce a 403 for a token problem, then allow it explicitly here.",
    ).toEqual([]);
  });
});
