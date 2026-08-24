import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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
 * ADR 0043 (`F4.16`) — no runtime file reads `process.env.DATABASE_URL` directly.
 *
 * `apps/api/src/database/database-urls.ts` resolves `DATABASE_URL_AUTH`/
 * `_TENANT`/`_FLEET` with no fallback to the owner `DATABASE_URL`, precisely so
 * the API can never silently run an RLS-adjacent query on a connection that
 * bypasses row level security. That guarantee only holds if every connection is
 * wired through the DI token system a compile-time sweep can check — a raw
 * `process.env.DATABASE_URL` read routes around it entirely, invisibly to `tsc`.
 *
 * Found on the F4.16 branch itself: `TelemetryNotifyService` read
 * `process.env.DATABASE_URL` directly, so Task 6.6's compiler-driven
 * `DRIZZLE`/`POOL_TOKEN` removal could not and did not catch it — removing
 * `DATABASE_URL` from `api`'s compose environment in Task 7 silently disabled
 * the `bms_telemetry` NOTIFY listener with no error anywhere. Fixed by pointing
 * it at one of the three named URLs instead (`tests/repo-invariants.test.ts` is
 * the model for this file; kept separate rather than added there because that
 * file sits at AGENTS.md §4.5's 1000-line cap).
 *
 * **Matches every shape, not just dot-access.** AGENTS.md §4.4 records that an
 * identically-shaped guard for `INGEST_NOTIFY` (`F1.1`) missed
 * `env["INGEST_NOTIFY"]`, `const { INGEST_NOTIFY } = env` and a `getEnv(...)`
 * helper before a compliance review caught them — three ways to read the same
 * variable that read perfectly naturally and a dot-access-only regex cannot
 * see. Comments are stripped first, matching that precedent, so this file's
 * own prose above does not trip its own check.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("ADR 0043 — no runtime file reads process.env.DATABASE_URL directly", () => {
  it("only database-urls.ts may name process.env.DATABASE_URL", () => {
    // Dot access (`process.env.DATABASE_URL`), bracket access
    // (`process.env["DATABASE_URL"]` / `env['DATABASE_URL']`), and
    // destructuring (`const { DATABASE_URL } = process.env`) all read the
    // same variable. `\b...\b` does not match inside `DATABASE_URL_AUTH` /
    // `_TENANT` / `_FLEET` — both neighbouring characters are word
    // characters, so no boundary falls between them — which is what keeps
    // this scoped to the bare name.
    const patterns = [
      /\benv\s*(?:\.\s*DATABASE_URL\b|\[\s*["']DATABASE_URL["']\s*\])/,
      /\{\s*DATABASE_URL\s*\}\s*=\s*process\.env\b/,
    ];

    const offenders = walk(join(repoRoot, "apps", "api", "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !/\.(spec|test)\.(ts|tsx)$/.test(f))
      .filter((f) => !/[/\\]database[/\\]database-urls\.ts$/.test(f))
      // ADR 0025 decision 8: apps/api/src/testing/ is excluded from the runtime
      // bundle (apps/api/tsconfig.build.json) and only test files may import
      // from it — repo-invariants.test.ts's "no runtime file imports a
      // test-only helper" check is what enforces that half.
      .filter((f) => !/[/\\]testing[/\\]/.test(f))
      .filter((f) => {
        const src = stripComments(readFileSync(f, "utf8"));
        return patterns.some((p) => p.test(src));
      })
      .map((f) => relative(repoRoot, f).replace(/\\/g, "/"));

    expect(
      offenders,
      `these files read process.env.DATABASE_URL directly: ${offenders.join(", ")}. ` +
        "Only apps/api/src/database/database-urls.ts may name that variable — every other " +
        "connection must go through DATABASE_URL_AUTH/_TENANT/_FLEET via a Drizzle DI token, " +
        "or it silently bypasses row-level security (ADR 0043) and no compiler sweep can find it.",
    ).toEqual([]);
  });
});
