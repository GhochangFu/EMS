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
 * **`F4.108` added the first global to this application, and this file is where
 * that was confessed.** ADR 0060 registers one `ZodErrorFilter` in `main.ts`.
 * The rule below failed on it, which is the rule working: its message asks for
 * the allowance to be explicit and for the "cannot produce a 403" claim to be
 * confirmed rather than asserted in prose. {@link ALLOWED_GLOBALS} records the
 * allowance and the two `it()`s after it hold the properties it rests on — the
 * filter's `@Catch` set and status, and the continued absence of a global
 * *guard*, which is the half an allowlisted `main.ts` would otherwise hide.
 *
 * **One real exception is worth knowing before reading a failure here.**
 * `audit.service.ts` throws a 403 for a valid, verified token whose subject
 * matches no `users` row ("this token matches no user"). That is a 403 with no
 * principal — and it argues *for* this behaviour rather than against it, since
 * signing in again cannot provision an account, so clearing the session there
 * would produce a login loop. The invariant is about repair, not about
 * principals.
 */
const FILTER = "apps/api/src/common/zod-error.filter.ts";
const MAIN = "apps/api/src/main.ts";

/**
 * The globals this rule allows, each with the reason the allowance is safe.
 *
 * Confirmed rather than assumed, which is what the rule's own message asks for:
 * `ZodErrorFilter` is `@Catch(ZodError)`, and an `UnauthorizedException` is not
 * a `ZodError`, so the filter is never consulted for a token problem; its only
 * status is `HttpStatus.BAD_REQUEST`. It is a **filter**, not a guard, so it
 * cannot make Nest synthesise a 403 by returning `false`.
 */
const ALLOWED_GLOBALS = new Set([FILTER, MAIN]);

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
    const found = walk(apiSrc)
      .filter((f) => f.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(f))
      .filter((f) =>
        /APP_GUARD|APP_FILTER|useGlobalGuards|useGlobalFilters|implements ExceptionFilter/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => relative(repoRoot, f).split(sep).join("/"));

    // **Order matters, and review found it backwards.** The positive control
    // used to fire first, so an *added* global — the failure this rule exists
    // for — was reported as "the two globals were not found … Either they were
    // removed", the wrong diagnosis, and the tailored message below was
    // unreachable. The real check runs first now. The control still earns its
    // place behind it: a broken walk finds nothing, "nothing minus the allowed
    // set" is empty, and the assertion above would pass over a scan of zero
    // files.
    const offenders = found.filter((f) => !ALLOWED_GLOBALS.has(f));

    expect(
      offenders,
      `a global guard or exception filter was added: ${offenders.join(", ")}. Either ` +
        "can turn an authentication failure into a 403 without changing " +
        "jwt-auth.guard.ts, which is the only file the sibling check reads. Confirm " +
        "it cannot produce a 403 for a token problem, then allow it explicitly here.",
    ).toEqual([]);

    expect(
      found.slice().sort(),
      "the two globals F4.108 registered were not found. Either they were removed — in " +
        "which case 44 controller sites are back to answering 500 and ADR 0060 is undone — " +
        "or this walk is broken and the assertion above proves nothing.",
    ).toEqual([...ALLOWED_GLOBALS].sort());
  });

  /**
   * The property that makes `ZodErrorFilter`'s allowance safe, rather than the
   * allowance being taken on trust.
   *
   * Widened to `@Catch()` it would see every exception, `UnauthorizedException`
   * included, and the sibling check above reads only `jwt-auth.guard.ts` — so
   * nothing else in this repository would notice.
   *
   * **The pattern is anchored to the decorator's position, and review is why.**
   * A bare `/@Catch\(ZodError\)/` over the whole source was satisfied by the
   * filter's own docblock, which contains the heading ``## Why `@Catch(ZodError)`
   * is narrow on purpose``. Mutating the decorator to `@Catch()` left this
   * `it()` **green** — measured on a mutated copy — in the very file that grants
   * the global its allowance. A file that documents the rule it is checked
   * against cannot be checked by a substring; requiring the decorator to be
   * followed by the class declaration puts the match on code.
   */
  it("the allowlisted ZodErrorFilter catches only ZodError and answers only 400", () => {
    const source = readFileSync(join(repoRoot, FILTER), "utf8");

    expect(
      /@Catch\(ZodError\)\s*\r?\nexport class ZodErrorFilter\b/.test(source),
      "zod-error.filter.ts must stay @Catch(ZodError) on the ZodErrorFilter declaration. " +
        "@Catch() with no argument catches every exception, including the 401 the JWT guard " +
        "throws. The pattern is anchored to the class declaration on purpose — the file's own " +
        "docblock quotes `@Catch(ZodError)` in prose, so an unanchored match passes over a " +
        "mutated decorator.",
    ).toBe(true);

    // Case-insensitive on purpose: the spelling this file would actually grow
    // is `HttpStatus.FORBIDDEN`, and `/Forbidden/` would not see it.
    expect(
      /forbidden|\b403\b/i.test(source),
      "zod-error.filter.ts now mentions a 403. Its allowance in ALLOWED_GLOBALS rests on it " +
        "answering HttpStatus.BAD_REQUEST and nothing else.",
    ).toBe(false);
  });

  /**
   * The half an allowlisted `main.ts` would otherwise hide.
   *
   * `useGlobalFilters` and `useGlobalGuards` are matched by the same rule
   * above, so allowing the file for the filter would silently allow a guard
   * added to it later — and a global guard returning `false` is how Nest
   * synthesises a 403 out of nothing.
   */
  it("main.ts registers a global filter and still no global guard", () => {
    const source = readFileSync(join(repoRoot, MAIN), "utf8");

    expect(
      /useGlobalFilters\(/.test(source),
      "main.ts no longer registers a global filter, so the assertion below is asserting the " +
        "absence of a guard in a file that was allowlisted for a filter that is gone",
    ).toBe(true);

    expect(
      /useGlobalGuards\(|APP_GUARD/.test(source),
      "main.ts now registers a global guard. A guard returning false makes Nest answer 403, " +
        "which strands the user on a screen re-authentication cannot repair — F4.52's whole " +
        "premise. ALLOWED_GLOBALS admits this file for ZodErrorFilter only.",
    ).toBe(false);
  });
});
