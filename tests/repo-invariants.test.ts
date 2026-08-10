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

  it("no rollup read reverts to bucketing raw telemetry", () => {
    // ADR 0025 (`F4.28`) moved six rollup reads onto the continuous aggregates.
    //
    // **This exists because no behavioural test can catch a revert**, and ADR 0025
    // decision 5 originally claimed otherwise. The parity suite compares each
    // converted site against the raw query it replaced — so if a site goes *back* to
    // that raw query, the comparison is the query against itself and passes. Mutation
    // testing showed the suite does catch a wrong aggregate *level* (`_1m` → `_5m`
    // fails on bucket count), but reading raw at minute granularity returns exactly
    // what `_1m` returns, so that direction is invisible. Nor do the two
    // discriminating sites rescue it: their "the naive form differs from raw"
    // assertion is a property of the fixture and holds under a revert too.
    //
    // Found by the `F4.28` compliance review. AGENTS.md §4.4 already says to read
    // rollups through the helper; this is what enforces it.
    //
    // Two markers, and between them every one of the six sites is covered: a revert
    // reintroduces a time bucket over raw, or an `avg` over raw's `value` column, or
    // both. Legitimate raw reads in these files — latest-value `DISTINCT ON`,
    // `MAX(value) FILTER`, `SUM(latest.kw)` — use neither, and `AVG(total_kw)` over
    // an already-aggregated CTE is untouched because it does not name `value`.
    const rollupFiles = [
      "apps/api/src/dashboard/dashboard.service.ts",
      "apps/api/src/reports/reports.service.ts",
    ];
    // Comments discuss both markers on purpose, so strip them before matching.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

    for (const rel of rollupFiles) {
      const sql = stripComments(readFileSync(join(repoRoot, rel), "utf8"));
      expect(
        sql,
        `${rel} buckets raw telemetry with date_trunc. Rollups read the ADR 0023 aggregates ` +
          "via point-aggregates.ts — the level's own bucket column IS the granularity, so no " +
          "date_trunc is needed. The parity suite cannot catch this: it compares against the " +
          "raw query, so a revert compares that query with itself and passes.",
      ).not.toMatch(/date_trunc/i);
      expect(
        sql,
        `${rel} averages raw telemetry's value column. Use avgExpr() — ` +
          "sum(sum_value)/sum(sample_count) — which is the only form that composes; an average " +
          "of averages was wrong in 151 of 169 buckets on real data (ADR 0023 fact 4).",
      ).not.toMatch(/\bavg\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\.?value\s*\)/i);
    }
  });

  it("every tests/*.test.ts file is typechecked by typecheck:tests", () => {
    // No tsconfig covers the top-level `tests/` directory, so these files are
    // typechecked only by the explicit file list at the end of the `typecheck:tests`
    // script. Vitest runs them through esbuild, which strips types without checking
    // them — so a file missing from that list still *runs*, and a type error in it
    // fails nothing anywhere.
    //
    // Found by the `F4.28` security review: `adr-0024-retention-bounds.test.ts` had
    // been missing since `F4.2`, and `adr-0025-level-selector.test.ts` was about to
    // repeat it. Adding both fixed the instances; this fixes the class, because the
    // next `tests/` file will otherwise be forgotten the same way.
    const script = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const typecheckTests = script.scripts?.["typecheck:tests"] ?? "";
    expect(typecheckTests, "package.json has no typecheck:tests script").not.toBe("");

    const missing = readdirSync(join(repoRoot, "tests"))
      .filter((name) => /\.test\.tsx?$/.test(name))
      .filter((name) => !typecheckTests.includes(`tests/${name}`));

    expect(
      missing,
      `tests/ files absent from the typecheck:tests file list:\n${missing.join("\n")}\n\n` +
        "Append them to the final `tsc --noEmit ...` invocation in package.json. Without that " +
        "they run but are never typechecked, so a type error in them fails nothing.",
    ).toEqual([]);
  });

  it("no runtime file imports a test-only helper from src/testing", () => {
    // ADR 0025 decision 8 (`F4.28`) put the extracted `DATABASE_URL` gate in
    // `apps/api/src/testing/`, and `apps/api/tsconfig.build.json` excludes that
    // folder so it stays out of the runtime bundle.
    //
    // **The exclusion does not enforce anything on its own, and this file exists
    // because the commit that added it claimed otherwise.** `tsc` pulls an
    // excluded-but-imported file back into the program and emits it; TS6307 only
    // fires under `composite: true`, and `apps/api/tsconfig.json` is not composite.
    // Reproduced against this repo: adding `import { integrationDbVerdict } from
    // "../testing/integration-db-gate"` to `health.controller.ts` left
    // `pnpm --filter api build` exiting **0** and emitting `dist/testing/`. So the
    // claim needed either `composite: true` — which changes declaration and
    // build-info emit for the whole API — or a check that actually runs. This is
    // the check.
    //
    // Why it matters: that helper reads `process.env.DATABASE_URL`, writes to
    // stderr, and can `throw` at module scope. None of that belongs on a path the
    // API imports at boot.
    const offenders = sourceFiles()
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !/\.(spec|test)\.(ts|tsx)$/.test(f))
      .filter((f) => !/[/\\]testing[/\\]/.test(f))
      .filter((f) => /from\s+["'][^"']*\/testing\/[^"']*["']/.test(readFileSync(f, "utf8")))
      .map((f) => relative(repoRoot, f).replace(/\\/g, "/"));

    expect(
      offenders,
      "runtime files importing from a testing/ directory:\n" +
        `${offenders.join("\n")}\n\n` +
        "Test-only helpers must not be reachable from the runtime bundle. Move the shared code " +
        "to a real module, or make the importer a .spec/.test file.",
    ).toEqual([]);
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

  it("no CSV writer escapes cells for itself", () => {
    // ADR 0026 (`F4.29`). This repo shipped two CSV exports with two escaping
    // rules: the audit one neutralised spreadsheet formulas, the Energy
    // Consumption one only quoted — so an asset code beginning `=` was delivered
    // as a live formula. The fix was one shared module, and this is what stops a
    // third copy appearing.
    //
    // It is a static check because no behavioural test can be: a new export with
    // its own escaping passes its own tests perfectly. The precedent is the
    // `DATABASE_URL` gate, which reached SIX copies before `F4.28` extracted it —
    // nothing was watching for the copies, so they accumulated.
    //
    // **`exports/export-phe-from-json.mjs` is deliberately out of range.** It has
    // the same quote-doubling line, but `sourceFiles()` walks `apps` and
    // `packages` only. It is a dev-time script whose input is the client's own SQL
    // Server dump and whose output is committed reference data, not a response to
    // a request — there is no untrusted writer and no reader being served. If you
    // ever widen `searchRoots`, exclude it by name rather than "fixing" it.
    const shared = "apps/api/src/serialise/csv.ts";
    const rel = (f: string): string => relative(repoRoot, f).replace(/\\/g, "/");
    const files = sourceFiles().filter((f) => /\.(ts|tsx)$/.test(f));

    // 1. CSV quote-doubling is the tell-tale of a hand-rolled cell escaper. Only
    //    the shared module may contain it.
    const escapers = files
      .filter((f) => readFileSync(f, "utf8").includes(`replace(/"/g, '""')`))
      .map(rel)
      .filter((f) => f !== shared);
    expect(
      escapers,
      `these files escape CSV cells themselves instead of importing ${shared} (ADR 0026 ` +
        `decision 1): ${escapers.join(", ")}. Import csvTextCell/csvNumberCell — do not copy the ` +
        "rule. A copy that omits the formula guard is exactly the defect F4.29 fixed.",
    ).toEqual([]);

    // 2. Nor may a second copy of the formula-leader list exist. Specs are exempt
    //    and hold a literal copy on purpose: a test that imports the constant it
    //    checks cannot detect the constant shrinking.
    const leaderList = /\["=",\s*"\+",\s*"-",\s*"@"/;
    const copies = files
      .filter((f) => leaderList.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== shared && !/\.spec\.tsx?$/.test(f));
    expect(
      copies,
      `these files carry their own copy of the formula-leader list: ${copies.join(", ")}. It lives ` +
        `in ${shared}. Only a *.spec.ts may restate it literally, and only because a test that ` +
        "imports the list cannot notice an entry being deleted from it.",
    ).toEqual([]);

    // 3. Any serialiser that deals in CSV must go through the shared module. This
    //    is the one that catches a *new* export rather than a modified one.
    const detached = files
      .filter((f) => /\.serialise\.tsx?$/.test(f))
      .filter((f) => /csv/i.test(readFileSync(f, "utf8")))
      .filter((f) => !readFileSync(f, "utf8").includes("serialise/csv"))
      .map(rel);
    expect(
      detached,
      `these serialisers mention CSV but do not import ${shared}: ${detached.join(", ")}. Every ` +
        "CSV export in this app shares one escaping rule (ADR 0026); a serialiser that opts out " +
        "is how the two exports diverged in the first place.",
    ).toEqual([]);
  });
});
