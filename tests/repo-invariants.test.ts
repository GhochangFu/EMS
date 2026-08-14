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
    // **What each check below does and does not reach**, because both 2026-08-10
    // reviews found the original comments overstated it:
    //   - Check 1 (quote-doubling) is the one that would have caught the actual
    //     `F4.29` defect — the old `csvCell` lived in `reports.service.ts` and
    //     contained the marker. It is idiom-keyed, so it is the strongest for a
    //     *modified* writer and blind to a differently-spelled one.
    //   - Check 3 is scoped to `*.serialise.ts` and therefore would **not** have
    //     caught `F4.29` at all. Its comment used to claim it caught new exports.
    //   - Check 4 is the one keyed on the response contract rather than on any
    //     escaping idiom, so it is what actually catches a *new* CSV endpoint. A
    //     writer cannot avoid the `text/csv` string and still be a CSV download.
    // None of them catches a new export that never quotes anything at all.
    const shared = "apps/api/src/serialise/csv.ts";
    const rel = (f: string): string => relative(repoRoot, f).replace(/\\/g, "/");
    const all = new Map(
      sourceFiles()
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .map((f) => [rel(f), readFileSync(f, "utf8")] as const),
    );
    // Checks 1–4 are scoped to `apps/api/src`, which is the only place that CAN
    // import the shared module. Running them repo-wide would trip a client-side
    // CSV builder in `apps/web` with advice it cannot follow — "import
    // apps/api/src/serialise/csv.ts" across an app boundary. Check 5 covers that
    // case with a message that makes sense for it.
    const body = new Map([...all].filter(([f]) => f.startsWith("apps/api/src/")));

    // 1. CSV quote-doubling is the tell-tale of a hand-rolled cell escaper. Only
    //    the shared module may contain it. Matched loosely enough to survive
    //    `replaceAll`, quote-style and whitespace variants — an exact-substring
    //    match was evadable by reformatting alone.
    const doublesQuotes = /(replace|replaceAll)\(\s*(\/"\/g|['"]"['"])\s*,\s*['"]""['"]\s*\)/;
    const escapers = [...body]
      .filter(([, src]) => doublesQuotes.test(src))
      .map(([f]) => f)
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
    const copies = [...body]
      .filter(([, src]) => leaderList.test(src))
      .map(([f]) => f)
      .filter((f) => f !== shared && !/\.spec\.tsx?$/.test(f));
    expect(
      copies,
      `these files carry their own copy of the formula-leader list: ${copies.join(", ")}. It lives ` +
        `in ${shared}. Only a *.spec.ts may restate it literally, and only because a test that ` +
        "imports the list cannot notice an entry being deleted from it.",
    ).toEqual([]);

    // 3. Any serialiser that deals in CSV must go through the shared module.
    const detached = [...body]
      .filter(([f, src]) => /\.serialise\.tsx?$/.test(f) && /csv/i.test(src))
      .filter(([, src]) => !src.includes("serialise/csv"))
      .map(([f]) => f);
    expect(
      detached,
      `these serialisers mention CSV but do not import ${shared}: ${detached.join(", ")}. Every ` +
        "CSV export in this app shares one escaping rule (ADR 0026); a serialiser that opts out " +
        "is how the two exports diverged in the first place.",
    ).toEqual([]);

    // 4. Every file that *serves* a CSV download must reach the shared module —
    //    directly or through the modules it imports. This is keyed on the response
    //    contract, not on an escaping idiom, so a new endpoint cannot slip past it
    //    by spelling its escaping differently. Two files declare `text/csv` today
    //    (`reports.controller.ts`, `audit.service.ts`) and both reach it at two
    //    hops, via their service and serialiser respectively.
    const reaching = new Set([shared]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [f, src] of body) {
        if (reaching.has(f)) continue;
        const dir = f.slice(0, f.lastIndexOf("/"));
        for (const [, spec] of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
          // Resolve the relative specifier against this file's directory.
          const parts = `${dir}/${spec}`.split("/");
          const stack: string[] = [];
          for (const part of parts) {
            if (part === "." || part === "") continue;
            if (part === "..") stack.pop();
            else stack.push(part);
          }
          if (reaching.has(`${stack.join("/")}.ts`)) {
            reaching.add(f);
            changed = true;
            break;
          }
        }
      }
    }
    const orphanWriters = [...body]
      .filter(([f, src]) => src.includes("text/csv") && !/\.(spec|test)\.tsx?$/.test(f))
      .map(([f]) => f)
      .filter((f) => !reaching.has(f));
    expect(
      orphanWriters,
      `these files serve a CSV download but no import path from them reaches ${shared}: ` +
        `${orphanWriters.join(", ")}. A CSV response whose bytes were not built by ` +
        "csvTextCell/csvNumberCell has its own escaping rule, which is the divergence ADR 0026 " +
        "closed. If this trips on a legitimately non-tabular text/csv passthrough, exclude it by " +
        "name with a reason — do not delete the check.",
    ).toEqual([]);

    // 5. Nothing OUTSIDE `apps/api/src` may build CSV. ADR 0026 covers one app,
    //    and `apps/web` cannot import across the boundary — today it only fetches
    //    the server's blob and saves it (`apps/web/src/api/reports.ts`). A
    //    client-side CSV builder would need its own escaping module and its own
    //    decision, so the useful thing this can do is refuse to let one appear
    //    silently, with a message that does not send the author to an unreachable
    //    import. `exports/export-phe-from-json.mjs` is outside `searchRoots`
    //    entirely, for the reason given above.
    const outside = [...all]
      .filter(([f]) => !f.startsWith("apps/api/src/") && !/\.(spec|test)\.tsx?$/.test(f))
      .filter(([, src]) => src.includes("text/csv") || doublesQuotes.test(src))
      .map(([f]) => f);
    expect(
      outside,
      `these files outside apps/api/src build or serve CSV: ${outside.join(", ")}. ${shared} is ` +
        "an api-internal module and cannot be imported from another app, so this is not a " +
        "'import the shared module' fix. A second CSV producer needs its own escaping module " +
        "carrying the same formula guard, and its own ADR — one export diverging from the rule " +
        "is exactly what ADR 0026 was written to undo.",
    ).toEqual([]);
  });

  it("ingest has one entry point and no NOTIFY switch", () => {
    // ADR 0016 §6 commit 4 ended the strangler migration. Both halves of that are
    // structural, and neither can be carried by a behavioural test:
    //
    //   - No suite fails if `src/index.js` reappears alongside `main.ts`. The
    //     two-entrypoint window reopening is exactly the "duplication becoming
    //     permanent" that Resolved decision 4 named as the realistic failure mode
    //     of a strangler, and it would look like an addition, not a regression.
    //   - `apps/ingest`'s own specs prove the *host* always notifies, but nothing
    //     stops a new `INGEST_NOTIFY` branch being added somewhere else, and the
    //     symptom is silent: rows keep landing while every dashboard goes dead.
    //
    // Amendment 3 records why this is the guarantee worth pinning statically.
    // `walk`, not `readdirSync` — a top-level scan says "apps/ingest/src must
    // hold exactly one entry point" while letting `src/legacy/index.js` through,
    // which is a message promising more than the check delivers.
    const ingestSrc = join(repoRoot, "apps", "ingest", "src");
    const entryPoints = walk(ingestSrc)
      .map((f) => relative(ingestSrc, f).split("\\").join("/"))
      .filter((f) => /(^|\/)(index|main)\.(ts|js)$/.test(f))
      .sort();
    expect(
      entryPoints,
      `apps/ingest/src must hold exactly one entry point and it must be main.ts, found: ` +
        `${entryPoints.join(", ")}. ADR 0016 §6 commit 4 deleted index.js; a second entry point ` +
        "reopens the two-entrypoint window the strangler migration closed. `rtu-config.js` is " +
        "not an entry point and is deliberately kept — it is the ADR 0012 credential seam.",
    ).toEqual(["main.ts"]);

    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "apps", "ingest", "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(
      pkg.scripts?.start,
      "apps/ingest `start` must run the compiled host. Anything else means the image's CMD " +
        "(`pnpm start`) is not the host, which is how the pilot silently runs the wrong process.",
    ).toBe("node dist/main.js");
    expect(
      Object.keys(pkg.scripts ?? {}),
      "`start:host` was removed at commit 4 — two names for one entry point is the duplication " +
        "the strangler exists to end.",
    ).not.toContain("start:host");

    // The flag must be gone from source *and* from the deployment. Compose is
    // included deliberately: `INGEST_NOTIFY: "on"` there was load-bearing before
    // commit 4, so a copy surviving would read as required configuration.
    //
    // **Reads and assignments, not mentions.** Naming the variable in prose is
    // how the next person learns why it must not come back — `config.ts` and
    // `main.ts` both explain the deletion, and an invariant that forbade the word
    // would force those comments out and take the reason with them.
    //
    // So comments are stripped first and then *any* mention of the name is a
    // failure. Matching `env.INGEST_NOTIFY` instead looks tighter and is weaker:
    // it misses `env["INGEST_NOTIFY"]`, `const { INGEST_NOTIFY } = env` and any
    // `getEnv("INGEST_NOTIFY")` helper — three ways to revive the switch that
    // read perfectly naturally. Compose likewise accepts both `KEY: value` and
    // list-form `- KEY=value`, and only the first was caught before.
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const compose = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
    const survivors = [...sourceFiles()]
      .map((f) => [relative(repoRoot, f).split("\\").join("/"), readFileSync(f, "utf8")] as const)
      .filter(
        ([f, src]) =>
          /\bINGEST_NOTIFY\b/.test(stripComments(src)) && !/\.(spec|test)\.tsx?$/.test(f),
      )
      .map(([f]) => f)
      .concat(
        /^\s*-?\s*INGEST_NOTIFY\s*[:=]/m.test(
          compose.replace(/(^|\s)#[^\n]*/g, "$1"),
        )
          ? ["docker-compose.yml"]
          : [],
      );
    expect(
      survivors,
      `INGEST_NOTIFY is read or set in: ${survivors.join(", ")}. ADR 0016 §6 commit 4 deleted it ` +
        "so that no configuration can run ingest with realtime off — a state in which telemetry " +
        "lands and every dashboard is dead, with no error and no alarm. Explaining the deletion " +
        "in a comment is fine and encouraged; reading the variable or setting it in compose is " +
        "not. The specs may read it (they assert it is inert).",
    ).toEqual([]);
  });

  it("the schematic staleness tick stays wired to the context value", () => {
    // `F4.37` clamped future telemetry timestamps so a dead asset stops
    // rendering `running`. The clamp is unit-tested; **the thing that makes it
    // observable is not, and cannot be** without a component test harness this
    // repo does not have (`apps/web/vitest.config.ts` is `environment: "node"`
    // by choice, and adding jsdom is a dependency ADR).
    //
    // The gap is specific. `deriveStatus` reads the clock during render, so it
    // is only re-evaluated when something re-renders the tree. On a healthy
    // system that is a socket payload — but the case this whole item exists for
    // is the asset going quiet, and if the *site* goes quiet nothing re-renders
    // at all. Every tile then freezes on its last computed status, which is the
    // original symptom with the arithmetic fixed underneath it. The consumers'
    // `refetchInterval: 15_000` does not rescue it: TanStack Query's structural
    // sharing returns the identical `data` reference when a refetch changes
    // nothing, so an unchanged rule list re-renders nothing.
    //
    // So `staleTick` must (a) exist on a timer and (b) be a dependency of the
    // context `value` memo — React propagates context by reference identity, so
    // a tick that does not change that identity notifies no consumer and is
    // dead code that looks alive. Both deletions were mutation-tested and both
    // are invisible to every *behavioural* suite: with the interval deleted the
    // full run reports 53 of 54 files passing and the only failing test is this
    // one. That is the measurement that justifies a static invariant here rather
    // than "we should add a component test later".
    //
    // This is the AGENTS.md §4.4 shape — a guard that cannot fire under the
    // condition it guards — reached by wiring rather than by a sentinel.
    const rel = "apps/web/src/components/live-svg/schematic-telemetry-context.tsx";
    const src = readFileSync(join(repoRoot, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

    expect(
      src,
      `${rel} must drive staleness re-evaluation from a timer. Without it the offline state is ` +
        "only reached when some other asset on the same schematic reports, so a site-wide outage " +
        "leaves every tile frozen on `running` — the exact F4.37 symptom, one layer down.",
    ).toMatch(/setInterval\(\s*\(\)\s*=>\s*\{[\s\S]{0,120}?setStaleTick/);
    expect(
      src,
      `${rel} must use the shared STALE_TICK_MS rather than an inline period, so the bound on ` +
        "offline-detection latency (FRESH_MS + STALE_TICK_MS) is stated in one place.",
    ).toMatch(/STALE_TICK_MS/);

    // Any dependency array carrying both — `totalKw` identifies the context
    // value's memo without pinning the rest of the list's order or contents.
    const depArrays = src.match(/\[[^[\]]*\]/g) ?? [];
    const wired = depArrays.some(
      (arr) => /\btotalKw\b/.test(arr) && /\bstaleTick\b/.test(arr),
    );
    expect(
      wired,
      `${rel} must list staleTick in the context value's useMemo dependencies. React propagates ` +
        "context by reference identity: if the memo does not depend on the tick, the value object " +
        "is reused, no consumer re-renders, and the timer runs forever changing nothing.",
    ).toBe(true);

    // The timer must be unconditional. `schematic-telemetry-context.tsx` says so
    // in a comment, and the F4.37 compliance review showed the two assertions
    // above did not hold it: gating the effect on
    // `if (trackedIds.length === 0) return;` — the shape the two effects either
    // side of it already use — left the whole suite green. A schematic whose
    // assets have not resolved yet still renders tiles that must go offline, and
    // an empty dependency array is what stops the interval being torn down and
    // recreated on unrelated state changes.
    // Anchored on `setInterval`, not on `setStaleTick`: the first `setStaleTick`
    // in the file is the `useState` destructure, which precedes every
    // `useEffect` and made an earlier version of this locator silently return
    // the empty string.
    const tickEffect = (() => {
      const at = src.indexOf("setInterval");
      if (at < 0) {
        return "";
      }
      const start = src.lastIndexOf("useEffect(", at);
      const depsAt = src.indexOf("}, [", at);
      return start < 0 || depsAt < 0 ? "" : src.slice(start, depsAt + 8);
    })();
    expect(
      tickEffect,
      "could not locate the staleness tick effect — the assertions below prove nothing.",
    ).not.toBe("");
    expect(
      /\}\s*,\s*\[\s*\]\s*\)/.test(tickEffect),
      `${rel}: the staleness interval must have an empty dependency array, so it is created once ` +
        "and never torn down by unrelated state.",
    ).toBe(true);
    expect(
      /\breturn\b/.test(tickEffect.slice(0, tickEffect.indexOf("setInterval"))),
      `${rel}: nothing may return from the staleness effect before setInterval. Gating it on ` +
        "trackedIds (the shape the neighbouring effects use) silently disables offline detection " +
        "for exactly the schematics that have not resolved their assets yet.",
    ).toBe(false);

    // Third leg, added by the F4.37 security review: the first two guarantee a
    // re-render happens, not that anything re-reads the clock when it does.
    // Memoising the status, or deriving `nowMs` from `ctx.staleTick` instead of
    // the clock, would leave the timer firing and the tiles frozen — and both
    // earlier assertions would still pass. The status must be computed from a
    // live `Date.now()` at render.
    expect(
      src,
      `${rel} must call deriveStatus with Date.now() read at render. Taking the time from the ` +
        "tick counter, or memoising the result, re-freezes every tile while leaving this file " +
        "looking correctly wired.",
    ).toMatch(/deriveStatus\(\s*\w+\s*,\s*Date\.now\(\)\s*\)/);
    // Residual this cannot reach: a *consumer* wrapping `useSchematicTelemetry`
    // in its own `useMemo` keyed on the slice would freeze the status again with
    // every assertion here still green. No consumer does that today.
  });

  it("every control-room page derives status through the shared staleness gate", () => {
    // ADR 0027 (`F4.38`). Each of these pages derives its own tile status, and
    // before `F4.38` **none** of them consulted `lastSeenMs` as a clock — a dead
    // leak or smoke sensor rendered `normal` indefinitely.
    //
    // **No behavioural test in this repo can hold this**, for the same reason as
    // the tick invariant above: the pages are React components and
    // `apps/web/vitest.config.ts` is `environment: "node"` by choice. The gate
    // itself (`isStale`, `freshValue`, `sumFresh`) is unit-tested in
    // `schematic-telemetry.spec.ts`; what cannot be tested is that the pages
    // still *call* it. Deleting the call from any one page restores the original
    // defect on that page alone, silently, and every suite stays green.
    //
    // Two things are asserted per page, matching ADR 0027 decisions 6 and 7:
    // the page consults the shared gate, and it does not invent its own
    // freshness window or its own timer. A page-local `FRESH_MS` would drift
    // from the schematic's; a page-local `setInterval` would duplicate the
    // provider's `staleTick` and re-render the tree twice as often.
    const pages = [
      "overview",
      "sld",
      "ups",
      "battery",
      "it",
      "hvac",
      "env",
    ].map((name) => `apps/web/src/pages/control-room-${name}-page.tsx`);

    const offenders: string[] = [];
    for (const rel of pages) {
      const src = readFileSync(join(repoRoot, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (!/\bisStale\s*\(/.test(src)) {
        offenders.push(`${rel} never calls isStale`);
      }
      if (!/from "\.\.\/lib\/schematic-telemetry"/.test(src)) {
        offenders.push(`${rel} does not import the shared gate`);
      }
      if (/\bFRESH_MS\s*=/.test(src)) {
        offenders.push(`${rel} defines its own freshness window`);
      }
      if (/\bsetInterval\s*\(/.test(src)) {
        offenders.push(`${rel} starts its own timer instead of using staleTick`);
      }
      // Decision 3 — a stale tile must not render its last numbers. Every page
      // has at least one numeric readout, so every page must gate at least one.
      if (!/\bfreshValue\s*\(/.test(src)) {
        offenders.push(`${rel} renders values without gating them on staleness`);
      }
      // Decision 2 — `offline` outranks `critical` in the page banner. Checked
      // by position because the ranking *is* the order of these lookups, and a
      // reordering is a one-line change that no assertion here would otherwise
      // see. `-sld-` has no mergeStatus and is skipped.
      const merge = src.slice(src.indexOf("function mergeStatus"));
      if (merge.startsWith("function mergeStatus")) {
        const off = merge.indexOf('"offline"');
        const crit = merge.indexOf('"critical"');
        if (off < 0 || crit < 0 || off > crit) {
          offenders.push(
            `${rel} ranks critical at or above offline in mergeStatus (ADR 0027 decision 2)`,
          );
        }
      }
    }
    // The aggregate half of decision 4 lives in the context, not the pages.
    // Mutation-tested: passing a constant instead of the clock to `sumFresh`
    // silently re-includes every dead asset in the bus total and no suite
    // notices, so the clock source is pinned here.
    const ctx = readFileSync(
      join(repoRoot, "apps/web/src/components/live-svg/schematic-telemetry-context.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // **Every** call, not any call. Two earlier versions of this check were
    // wrong and both were caught by mutating rather than by reading: `[^)]*`
    // stops at the arrow function's own parenthesis and failed on clean code,
    // and a single `.test()` passed because the *other* `sumFresh` call still
    // carried the clock while the mutated one did not.
    if (!/const nowMs = Date\.now\(\);/.test(ctx)) {
      offenders.push(
        "schematic-telemetry-context.tsx must read Date.now() when summing totalKw",
      );
    }
    for (let i = ctx.indexOf("sumFresh("); i >= 0; i = ctx.indexOf("sumFresh(", i + 1)) {
      const call = ctx.slice(i, ctx.indexOf(");", i) + 2);
      if (!/,\s*nowMs\s*\)/.test(call)) {
        offenders.push(
          `schematic-telemetry-context.tsx calls sumFresh without the clock: ${call.trim()} — ` +
            "a constant there re-includes dead assets in the bus total",
        );
      }
    }

    // **Known limit, stated rather than implied.** These checks prove each page
    // consults the gate; they do not prove *every* rendered value is gated.
    // Mutation-tested: dropping `freshValue` from a single render site survives,
    // because the page still calls it elsewhere. Closing that needs a component
    // test harness this repo does not have (jsdom is a dependency ADR).
    expect(
      offenders,
      `ADR 0027 violated: ${offenders.join("; ")}. Every control-room page must decide staleness ` +
        "through `isStale` from `lib/schematic-telemetry`, and must take its re-render from the " +
        "provider's staleTick rather than its own interval. A page that stops consulting the gate " +
        "renders a dead sensor's last value as a live reading — for leak and smoke sensors that is " +
        "a safety-relevant claim the page cannot support.",
    ).toEqual([]);
  });
});
