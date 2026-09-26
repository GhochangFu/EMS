import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isDocsOnly, isDocumentationPath } from "../scripts/checks/ci-scope.mjs";

/**
 * Actions minutes (the 90% warning of 2026-09-26): `.github/workflows/ci.yml`
 * skips `build-and-migrate` for a change set that touches only documentation
 * and runs the repo-invariant tests instead. A wrong answer here in the
 * "docs only" direction ships code untested, so every case below that is not
 * plainly Markdown must answer "code". Repo-wide invariant: assertions inline
 * (AGENTS.md §4.6 carve-out for `tests/`).
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repoRoot, "scripts", "checks", "ci-scope.mjs");

describe("ci-scope — which paths are documentation", () => {
  it("counts Markdown anywhere and non-script files under docs/", () => {
    expect(
      ["AGENTS.md", "docs/BACKLOG.md", "docs/adr/0070-sustainability-metrics-engine.md", "apps/web/README.md", "docs/status/backlog-dashboard.html"].map(isDocumentationPath),
    ).toEqual([true, true, true, true, true]);
  });

  it("counts code, config, the workflow and docs/scripts as not documentation", () => {
    expect(
      ["apps/api/src/app.module.ts", ".github/workflows/ci.yml", "docs/scripts/backlog-status.mjs", "package.json", "pnpm-lock.yaml", "tests/repo-invariants.test.ts", "scripts/checks/ci-scope.mjs", ""].map(isDocumentationPath),
    ).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("answers docs-only for a closure-shaped change set", () => {
    expect(isDocsOnly(["docs/BACKLOG.md", "docs/roadmap.md", ""])).toBe(true);
  });

  it("answers code when one path in the set is code", () => {
    expect(isDocsOnly(["docs/BACKLOG.md", "apps/api/src/dashboard/energy-centre.ts"])).toBe(false);
  });

  it("answers code for an empty change set", () => {
    expect(isDocsOnly([])).toBe(false);
  });
});

describe("ci-scope — the CLI the workflow runs", () => {
  const run = (cwd: string, ...args: string[]): string =>
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

  /** A throwaway repository: a base commit, a docs-only commit, a code commit, then a code file moved into docs/. */
  function fixtureRepo(): { dir: string; base: string; docs: string; code: string; moved: string } {
    const dir = mkdtempSync(join(tmpdir(), "ci-scope-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=ci-scope", "-c", "user.email=ci-scope@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
    git("init", "-q");
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "BACKLOG.md"), "a\n");
    writeFileSync(join(dir, "main.ts"), "export {};\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "docs", "BACKLOG.md"), "b\n");
    writeFileSync(join(dir, "AGENTS.md"), "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "docs");
    const docs = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "main.ts"), "export const x = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "code");
    const code = git("rev-parse", "HEAD");
    mkdirSync(join(dir, "docs", "archive"));
    git("mv", "main.ts", "docs/archive/main.ts");
    git("commit", "-q", "-m", "move code into docs");
    const moved = git("rev-parse", "HEAD");
    return { dir, base, docs, code, moved };
  }

  it("prints code=false for a docs-only range, two-dot and three-dot", () => {
    const r = fixtureRepo();
    try {
      expect([run(r.dir, r.base, r.docs, "two-dot"), run(r.dir, r.base, r.docs, "three-dot")]).toEqual(["code=false", "code=false"]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("prints code=true when the range holds a code change", () => {
    const r = fixtureRepo();
    try {
      expect(run(r.dir, r.base, r.code, "two-dot")).toBe("code=true");
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("prints code=true when a code file is moved into docs/ (the rename's source counts)", () => {
    const r = fixtureRepo();
    try {
      expect([run(r.dir, r.code, r.moved, "two-dot"), run(r.dir, r.code, r.moved, "three-dot")]).toEqual(["code=true", "code=true"]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("prints code=true for a new branch (all-zero base), a missing base and an unknown commit", () => {
    const r = fixtureRepo();
    try {
      expect([
        run(r.dir, "0000000000000000000000000000000000000000", r.docs, "two-dot"),
        run(r.dir, "", r.docs, "two-dot"),
        run(r.dir, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", r.docs, "two-dot"),
      ]).toEqual(["code=true", "code=true", "code=true"]);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });
});

describe("ci.yml — the docs-only split and the concurrency rule", () => {
  const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const job = (name: string): string => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    expect(start, `ci.yml must define the ${name} job`).toBeGreaterThan(-1);
    const next = ci.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
  };

  it("runs build-and-migrate unless the changes job answers code=false, and when that job fails", () => {
    expect(job("build-and-migrate")).toMatch(/needs: changes\n\s+if: \$\{\{ !cancelled\(\) && needs\.changes\.outputs\.code != 'false' \}\}/);
  });

  it("runs the repo-invariant tests, without the database suites, only on an explicit code=false", () => {
    const docs = job("docs-only-tests");
    expect([
      /if: needs\.changes\.outputs\.code == 'false'/.test(docs),
      docs.includes('vitest run --project repo --exclude "**/*.integration.test.ts"'),
    ]).toEqual([true, true]);
  });

  it("classifies with the script this file tests, on a full-depth checkout", () => {
    const changes = job("changes");
    expect([changes.includes("node scripts/checks/ci-scope.mjs"), /fetch-depth: 0/.test(changes)]).toEqual([true, true]);
  });

  it("cancels superseded runs on pull requests only", () => {
    expect(ci).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  });

  it("gives each push its own concurrency group, so no main run is replaced while pending", () => {
    expect(ci).toMatch(/group: \$\{\{ github\.event_name == 'pull_request' && format\('ci-pr-\{0\}', github\.event\.pull_request\.number\) \|\| format\('ci-push-\{0\}', github\.run_id\) \}\}/);
  });

  it("still runs the client dashboard leak check with no condition and no dependency", () => {
    expect(job("client-dashboard-leak-check")).not.toMatch(/\n\s+(if|needs):/);
  });
});
