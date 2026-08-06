import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const searchRoots = ["apps", "packages"];
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

function sourceFiles(): string[] {
  return searchRoots.flatMap((root) => {
    const dir = join(repoRoot, root);
    try {
      return walk(dir);
    } catch {
      return [];
    }
  });
}

/**
 * Repository-wide structural invariants (ADR 0014).
 *
 * These guard the failure mode this repo keeps hitting: an artefact exists and
 * looks authoritative, but nothing executes it. The drizzle journal hook
 * (`.claude/hooks/check-drizzle-journal.mjs`) is the same idea for migrations;
 * this is its counterpart for tests.
 */
describe("repo invariants", () => {
  it("every .spec file has a .test wrapper that runs it", () => {
    const files = sourceFiles();
    const present = new Set(files);

    const orphans = files
      .filter((f) => /\.spec\.(ts|tsx|js|mjs)$/.test(f))
      .filter((f) => !present.has(f.replace(/\.spec\.(ts|tsx|js|mjs)$/, ".test.$1")))
      .map((f) => relative(repoRoot, f).replace(/\\/g, "/"));

    // Assertions live in .spec files, but Vitest only discovers .test files —
    // and it excludes .spec files from coverage too, so an unwrapped spec is
    // invisible to both the runner and the coverage gate. This is the only
    // thing that catches it. If you are reading this because the test failed:
    // add the sibling wrapper, do not delete the spec.
    expect(orphans, `spec files that no .test wrapper runs:\n${orphans.join("\n")}`).toEqual([]);
  });

  it("no source file exceeds the AGENTS.md §4.5 1000-line cap", () => {
    // §4.5 has capped files at 1000 lines since Phase 1, and nothing enforced
    // it: `rules.service.ts` sat at 1029 until someone happened to count. A
    // rule with no gate is a preference. This is the gate.
    //
    // Deliberately no allowlist. An exemption is how the cap dies quietly —
    // the entry outlives the reason, and the next oversized file cites it as
    // precedent. If a file genuinely needs to be bigger, that is an AGENTS.md
    // change under §9.10, not a line in this array.
    //
    // Two limits worth stating rather than leaving to be rediscovered:
    //  - Source files only. Generated data such as
    //    `packages/db/src/phe-catalog.json` (6346 lines) is not code and the
    //    cap is not about it.
    //  - `sourceFiles()` walks `apps` and `packages`, a root list chosen for
    //    the §4.6 orphan-spec check. §4.5's cap is unqualified, so top-level
    //    `tests/`, `docs/scripts/` and `.claude/hooks/` are exempt here by
    //    inheritance rather than by decision. Nothing in them is close to the
    //    cap today; widening the roots is a separate change.
    const LIMIT = 1000;

    const oversized = sourceFiles()
      .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))
      .map((f) => ({
        path: relative(repoRoot, f).replace(/\\/g, "/"),
        // Trailing-newline-insensitive: a file of exactly LIMIT content lines
        // must not fail merely because it ends with a newline, as it should.
        lines: readFileSync(f, "utf8").replace(/\r?\n$/, "").split(/\r?\n/).length,
      }))
      .filter((entry) => entry.lines > LIMIT)
      .map((entry) => `${entry.path} (${entry.lines} lines)`);

    expect(
      oversized,
      `files over the ${LIMIT}-line cap in AGENTS.md §4.5:\n${oversized.join("\n")}`,
    ).toEqual([]);
  });

  it(".dockerignore excludes env files at every depth, not just the context root", () => {
    const patterns = readFileSync(join(repoRoot, ".dockerignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    // Docker matches .dockerignore patterns against the context-relative path
    // and `*` does not cross `/`, so a bare `.env` excludes ONLY the root file.
    // `apps/api/.env` — which README instructs developers to create, and which
    // holds JWT_SECRET and DATABASE_URL — was reaching the image through
    // `COPY apps/api apps/api` until the `**/` variants were added. Verified
    // empirically with a busybox build; see docs/security/encryption-at-rest.md.
    const required = ["**/.env", "**/.env.*", "**/*.env", "**/.npmrc"];
    const missing = required.filter((p) => !patterns.includes(p));
    expect(
      missing,
      `.dockerignore is missing depth-recursive secret exclusions: ${missing.join(", ")}. ` +
        "Without these, a developer's real .env under apps/* is baked into the image layer.",
    ).toEqual([]);

    // Presence checks alone are NOT enough. Docker is last-match-wins, so
    // appending `!**/.env` (or `!**`) leaves every required pattern present and
    // correctly ordered while silently re-admitting the file — a green gate
    // asserting a hole is closed while it is open. So evaluate real paths
    // through the actual pattern list instead of trusting `includes()`.
    const toRegExp = (pattern: string): RegExp => {
      let re = "";
      let i = 0;
      while (i < pattern.length) {
        if (pattern[i] === "*" && pattern[i + 1] === "*") {
          if (pattern[i + 2] === "/") {
            re += "(?:[^/]+/)*"; // `**/` — zero or more directories
            i += 3;
          } else {
            re += ".*";
            i += 2;
          }
        } else if (pattern[i] === "*") {
          re += "[^/]*"; // `*` does not cross a separator
          i += 1;
        } else if (pattern[i] === "?") {
          re += "[^/]";
          i += 1;
        } else {
          re += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
          i += 1;
        }
      }
      return new RegExp(`^${re}$`);
    };

    const isExcluded = (path: string): boolean => {
      let excluded = false;
      for (const pattern of patterns) {
        const negated = pattern.startsWith("!");
        if (toRegExp(negated ? pattern.slice(1) : pattern).test(path)) {
          excluded = !negated; // last match wins, exactly like Docker
        }
      }
      return excluded;
    };

    // Secret-bearing paths that must never reach a layer.
    for (const secret of [
      ".env",
      "apps/api/.env",
      "apps/api/.env.local",
      "apps/ingest/.env.production",
      "apps/api/pilot.env",
      "apps/ingest/phe.env",
      "apps/api/certs/client.pem",
      "apps/api/certs/client.key",
      "apps/ingest/ca.crt",
      "apps/api/.npmrc",
    ]) {
      expect(isExcluded(secret), `${secret} must be excluded from the build context`).toBe(true);
    }

    // Committed placeholders carry no secrets and are already public in git, so
    // excluding them would be pointless churn. Source must obviously still ship —
    // an over-broad exclusion breaks the build rather than leaking, but it is the
    // other way this file can be wrong.
    for (const shipped of [
      ".env.example",
      "apps/api/.env.example",
      "apps/api/.env.production.example",
      "apps/api/src/main.ts",
      "package.json",
    ]) {
      expect(isExcluded(shipped), `${shipped} must remain in the build context`).toBe(false);
    }
  });

  it("every mutating operations handler carries the ADR 0017 write gate", () => {
    // The four operations controllers authorize on asset scope, not on role.
    // Before ADR 0017 that meant any authenticated user with a non-empty read
    // scope could write. The matrix spec proves the gate's *decisions* are
    // right; this proves the gate is actually *applied*. Without it the next
    // @Post added here ships ungated and nothing notices — the same
    // "artefact exists, nothing enforces it" shape as an unwrapped spec.
    const controllers = [
      "apps/api/src/rules/rules.controller.ts",
      "apps/api/src/alarms/alarms.controller.ts",
      "apps/api/src/work-orders/work-orders.controller.ts",
      "apps/api/src/maintenance/maintenance.controller.ts",
    ];
    const routed = /^\s*@(Post|Patch|Put|Delete)\(/;
    const anyRoute = /^\s*@(Post|Patch|Put|Delete|Get)\(/;

    const ungated: string[] = [];
    for (const rel of controllers) {
      const lines = readFileSync(join(repoRoot, rel), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!routed.test(line)) return;
        // Handler body runs from this decorator to the next routed member.
        let end = i + 1;
        while (end < lines.length && !anyRoute.test(lines[end])) end += 1;
        const body = lines.slice(i, end).join("\n");
        if (!body.includes("assertOperationsWriteRole")) {
          ungated.push(rel + ":" + (i + 1) + " " + line.trim());
        }
      });
    }

    expect(
      ungated,
      "mutating handlers missing assertOperationsWriteRole (ADR 0017): " +
        ungated.join(" | "),
    ).toEqual([]);
  });
});
