import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const GUARD_REL = "apps/api/src/auth/jwt-auth.guard.ts";
const CONTRACT_REL = "packages/shared/src/contracts/auth.ts";

/** Strips block and line comments, so a docblock that quotes code cannot satisfy a scan. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every `.ts`/`.tsx` file under `rel`, as repo-relative forward-slash paths. */
function tsFiles(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(relative(repoRoot, full).split("\\").join("/"));
    }
  };
  walk(join(repoRoot, rel));
  return out;
}

/** The files whose comment-stripped source still matches an email lookup on `bms.users`. */
function emailLookupFiles(): string[] {
  return [...tsFiles("apps/api/src"), ...tsFiles("packages/db/src")].filter((rel) =>
    /eq\(\s*users\.email\s*,/.test(codeOnly(read(rel))),
  );
}

/** The files the subject rule allows an email lookup in (ADR 0089 decision 4). */
const EMAIL_LOOKUP_ALLOWED = [
  "apps/api/src/auth/auth.service.ts",
  "apps/api/src/auth/identity-resolver.ts",
  "packages/db/src/demo-users-seed.ts",
];

/**
 * `F3.78` / ADR 0089 decisions 4 and 5 — the static half of plan U2.
 *
 * **The guard's `@Inject(AUTH_DRIZZLE)` is a DI change no spec can prove**:
 * vitest compiles through esbuild, which emits no `design:paramtypes`, so
 * every spec constructs the guard by hand. Without the decorator Nest cannot
 * resolve the second constructor argument and the API does not boot; this
 * file pins the decorator, and the boot itself is the step-6 check (`api` and
 * `api-replica` log "Nest application successfully started").
 *
 * Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.78 — the guard's auth-pool injection, the token contract and the subject rule", () => {
  it("the guard constructor injects the auth pool with @Inject(AUTH_DRIZZLE)", () => {
    const code = codeOnly(read(GUARD_REL));
    const ctor = /constructor\(([\s\S]*?)\)\s*\{/.exec(code)?.[1] ?? "";
    expect(ctor).toContain("JwtService");
    expect(ctor).toMatch(/@Inject\(AUTH_DRIZZLE\)\s+private readonly authDb: BmsDb/);
  });

  it("the guard docblock names the step-6 boot check", () => {
    expect(read(GUARD_REL)).toContain("Nest application successfully started");
  });

  it("the JWT payload contract carries emailVerified", () => {
    expect(codeOnly(read(CONTRACT_REL))).toMatch(/emailVerified:\s*z\.boolean\(\)\.optional\(\)/);
  });

  it("the scan finds the allowed email lookup in auth.service.ts (positive control)", () => {
    expect(emailLookupFiles()).toContain("apps/api/src/auth/auth.service.ts");
  });

  it("no file outside the three allowed ones resolves a user by eq(users.email, …)", () => {
    expect(emailLookupFiles().filter((rel) => !EMAIL_LOOKUP_ALLOWED.includes(rel))).toEqual([]);
  });
});
