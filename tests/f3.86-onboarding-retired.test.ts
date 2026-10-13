import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.86` PR 7 (ruling Q5, ADR 0099 decision 7) — the old onboarding page is
 * retired. Onboarding is the copilot dock's skill: the SPA route
 * `/admin/organizations/:orgId/onboarding`, the route
 * `POST /admin/onboarding/sessions/:id/chat` and the typed phrase
 * `confirm commit` no longer exist. Only the Commit button of the draft preview
 * and the copilot's Confirm card commit.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.21` model. Each
 * guard has its positive control beside it: an absence check that cannot find a
 * known neighbour proves nothing.
 *
 * **Comments are stripped before the scans.** A docblock may say what was
 * removed, and may quote the old route or the phrase; a live line may not.
 */
const APP_ROUTES_REL = "apps/web/src/app.tsx";
const CONTROLLER_REL = "apps/api/src/admin/onboarding/onboarding.controller.ts";

/** Block comments and line comments out; strings are kept (the scans look for string literals). */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      if (line.trim().startsWith("//")) return "";
      // A trailing `// note` after code. A `//` inside a URL has no space before it, so it stays.
      return line.replace(/\s\/\/\s.*$/, "");
    })
    .join("\n");

const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".turbo", "playwright-report", "test-results"]);

/** Every `.ts` and `.tsx` file under `rel`, as repo-relative paths with forward slashes. */
function sourceFiles(rel: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIPPED_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
        out.push(relative(repoRoot, full).split("\\").join("/"));
      }
    }
  };
  visit(join(repoRoot, rel));
  return out;
}

const isTestFile = (file: string): boolean => /\.(spec|test)\.tsx?$/.test(file);

/** Each file read and stripped once: the scans below share the text. */
const codeCache = new Map<string, string>();
const codeOf = (file: string): string => {
  let code = codeCache.get(file);
  if (code === undefined) {
    code = withoutComments(read(file));
    codeCache.set(file, code);
  }
  return code;
};

/** The files whose comment-free text matches `pattern`. */
function filesMatching(files: readonly string[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(codeOf(file)));
}

const appFiles = sourceFiles("apps");
const appSource = appFiles.filter((file) => !isTestFile(file));

describe("F3.86 PR 7 — the old onboarding page is retired (ruling Q5)", { timeout: 60_000 }, () => {
  it("the scan reads .ts and .tsx, spec and source alike (control)", () => {
    expect(appFiles.length).toBeGreaterThan(100);
    expect(appFiles.some((file) => file.endsWith(".tsx"))).toBe(true);
    expect(appFiles.some((file) => file.endsWith(".ts") && !file.endsWith(".tsx"))).toBe(true);
    expect(appSource.length).toBeLessThan(appFiles.length);
  });

  it("strips comments but keeps code (control for the comment-free scans)", () => {
    const sample = ['// confirm commit', '/* confirm commit', ' * confirm commit */', 'const x = "http://a";', 'const y = 1; // confirm commit'].join("\n");
    const code = withoutComments(sample);
    expect(code).not.toMatch(/confirm commit/);
    expect(code).toContain('"http://a"');
  });

  it("app.tsx has no organizations/:orgId/onboarding route", () => {
    const code = withoutComments(read(APP_ROUTES_REL));
    expect(code).toContain("/admin/organizations");
    expect(code).not.toMatch(/organizations\/:orgId\/onboarding/);
  });

  it("onboarding.controller.ts has no sessions/:id/chat route on a non-comment line", () => {
    const code = withoutComments(read(CONTROLLER_REL));
    expect(code).toContain("sessions/:id/commit");
    expect(code).not.toContain("sessions/:id/chat");
  });

  it("no file under apps/ exports CONFIRM_COMMIT_PHRASE", () => {
    const exportsIt = /export\s+(?:const|let|var|function)\s+CONFIRM_COMMIT_PHRASE\b|export\s*\{[^}]*\bCONFIRM_COMMIT_PHRASE\b/;
    // Control: the same walk and pattern shape find a neighbour that is exported.
    const neighbour = /export\s+(?:const|let|var|function)\s+COMMIT_PROPOSAL_KEY\b/;
    expect(filesMatching(appFiles, neighbour)).toEqual(["apps/api/src/admin/onboarding/onboarding-commit-proposal.ts"]);
    expect(filesMatching(appFiles, exportsIt)).toEqual([]);
  });

  it("no non-test source file under apps/ holds the literal `confirm commit` outside a comment", () => {
    const phrase = /confirm commit/i;
    // Control: the scan reads .tsx — it finds a known .tsx literal — and .ts — it finds a known .ts one.
    const tsxHits = filesMatching(appSource, /Onboard a site/);
    expect(tsxHits).toContain("apps/web/src/components/copilot/copilot-dock.tsx");
    const tsHits = filesMatching(appSource, /You cannot commit/);
    expect(tsHits).toContain("apps/api/src/admin/onboarding/onboarding-agent-loop.ts");
    expect(filesMatching(appSource, phrase)).toEqual([]);
  });

  it("the page and its specs are gone, and the dock names no onboarding route", () => {
    expect(existsSync(join(repoRoot, "apps/web/src/components/copilot/copilot-dock.tsx"))).toBe(true);
    expect(existsSync(join(repoRoot, "apps/web/src/pages/admin/onboarding-chat-page.tsx"))).toBe(false);
    expect(withoutComments(read("apps/web/src/components/copilot/copilot-dock.tsx"))).not.toMatch(/ONBOARDING_ROUTE/);
  });
});
