import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.7` / ADR 0100 — the shape of the Playwright end-to-end suite.
 *
 * Playwright is a second runner (AGENTS.md §4.6 needs an ADR for one), so the
 * suite must stay apart from Vitest: its specs are `*.e2e.ts`, `apps/e2e` is
 * not a Vitest project, and `pnpm build` never builds it. The workflow runs on
 * the `e2e` label only, with no secret, and the base-URL guard keeps the suite
 * off any shared deployment. Files are read as text (no YAML parser), as
 * `tests/ci-docs-only-scope.test.ts` does. Repo-wide invariant: assertions
 * inline (AGENTS.md §4.6 carve-out for `tests/`).
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const e2eRoot = join(repoRoot, "apps", "e2e");
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf8");

const PLAYWRIGHT_VERSION = "1.63.0";
const SKIP_DIRS = new Set(["node_modules", ".auth", "test-results", "playwright-report"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(join(dir, entry.name)));
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const rel = (f: string): string => relative(repoRoot, f).replace(/\\/g, "/");

describe("F4.7 — the e2e suite shape (ADR 0100)", () => {
  it("I1 pins @playwright/test exactly, as a devDependency of apps/e2e", () => {
    const pkg = JSON.parse(read("apps", "e2e", "package.json")) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.["@playwright/test"]).toBe(PLAYWRIGHT_VERSION);
  });

  it("I2 keeps the e2e specs out of Vitest and inside Playwright's testMatch", () => {
    const vitestConfig = read("vitest.config.ts");
    expect(vitestConfig, "the root vitest.config.ts must not list apps/e2e").not.toMatch(/apps\/e2e/);

    const files = walk(e2eRoot);
    expect(
      files.filter((f) => /[\\/]vitest\.config\.[^\\/]+$/.test(f)).map(rel),
      "apps/e2e must not carry a Vitest config",
    ).toEqual([]);
    expect(
      files.filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f)).map(rel),
      "apps/e2e files must be named *.e2e.ts, never *.spec.ts or *.test.ts",
    ).toEqual([]);
    expect(
      walk(join(e2eRoot, "specs"))
        .filter((f) => !f.endsWith(".e2e.ts"))
        .map(rel),
      "every file in apps/e2e/specs must end .e2e.ts",
    ).toEqual([]);

    const config = read("apps", "e2e", "playwright.config.ts");
    expect(config).toMatch(/testMatch:\s*["']\*\*\/\*\.e2e\.ts["']/);
  });

  it("I3 wires the root scripts: typecheck:tests checks apps/e2e, test:e2e exists, build skips it", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["typecheck:tests"]).toContain("tsc -p apps/e2e/tsconfig.json --noEmit");
    expect(pkg.scripts["test:e2e"]).toBeTypeOf("string");
    expect(pkg.scripts["test:e2e"]).toContain("e2e");
    expect(pkg.scripts.build).not.toMatch(/e2e/);
  });

  it("I5 assertLocalBaseUrl accepts only 127.0.0.1 and localhost", async () => {
    const { assertLocalBaseUrl } = (await import("../apps/e2e/src/base-url.js")) as {
      assertLocalBaseUrl: (url: string) => URL;
    };
    expect(assertLocalBaseUrl("http://127.0.0.1:5173").hostname).toBe("127.0.0.1");
    expect(assertLocalBaseUrl("http://localhost:5173").hostname).toBe("localhost");
    for (const bad of [
      "https://bms.demosites.co.in",
      "http://127.0.0.1.evil.example:5173",
      "http://192.168.1.5:5173",
      "http://[::1]:5173",
      "not a url",
    ]) {
      expect(() => assertLocalBaseUrl(bad), bad).toThrow(/E2E base URL/);
    }
  });

  it("I6 git-ignores the per-run storageState files", () => {
    const lines = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain("apps/e2e/.auth/");
  });
});

/**
 * I4 — the workflow. `.github/workflows/e2e.yml` lands in plan task T9; that
 * unit removes `.skip` here and must see every assertion below go green. Do
 * not turn this into `runIf(existsSync(...))`: a missing workflow would then
 * pass silently.
 */
describe.skip("F4.7 — I4 the e2e workflow (T9 removes .skip)", () => {
  it("I4 runs on the e2e label or by hand, with no secret, on ci.yml's images", () => {
    const wf = read(".github", "workflows", "e2e.yml");
    const ci = read(".github", "workflows", "ci.yml");

    expect(wf).toContain("types: [labeled]");
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("github.event.label.name == 'e2e'");
    expect(wf).toContain("playwright install --with-deps chromium");
    expect(wf).toContain("retention-days: 3");
    expect(wf).not.toContain("pull_request_target");
    expect(wf).not.toContain("secrets.");

    const image = (text: string, pattern: RegExp): string | undefined =>
      text
        .split(/\r?\n/)
        .map((l) => /^\s*image:\s*(\S+)\s*$/.exec(l)?.[1])
        .find((img) => img !== undefined && pattern.test(img));
    const ciPostgres = image(ci, /timescale/);
    const ciRedis = image(ci, /^redis:/);
    expect(ciPostgres).toBeTypeOf("string");
    expect(ciRedis).toBeTypeOf("string");
    expect(image(wf, /timescale/)).toBe(ciPostgres);
    expect(image(wf, /^redis:/)).toBe(ciRedis);

    const cacheKey = wf.split(/\r?\n/).find((l) => /^\s*key:\s*pw-/.test(l));
    expect(cacheKey, "the Chromium cache key must be keyed on the Playwright version").toBeDefined();
    const pkg = JSON.parse(read("apps", "e2e", "package.json")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@playwright/test"]).toBe(PLAYWRIGHT_VERSION);
    expect(cacheKey).toMatch(/PW_VERSION|1\.63\.0/);
    if (cacheKey?.includes("PW_VERSION")) {
      // The key names the variable, so the variable must come from the pinned manifest.
      expect(wf).toMatch(/PW_VERSION[\s\S]*apps\/e2e\/package\.json|apps\/e2e\/package\.json[\s\S]*PW_VERSION/);
    }
  });
});
