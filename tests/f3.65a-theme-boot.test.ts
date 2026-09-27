import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";

/**
 * `F3.65a` — the theme boot script (plan `docs/plans/f3.65a-colour-tokens.md` §4 U6, ADR 0078
 * decision 6 / plan D6). `apps/web/index.html` gets a plain inline `<script>` (no `type`, so it
 * runs synchronously before the module script and before first paint) that reads
 * `localStorage["bms.theme"]` and sets `data-theme` on `<html>` to `"dark"` only for the exact
 * value `"dark"`, `"light"` for everything else (missing key, any other string, or a throwing
 * storage). No `prefers-color-scheme` / `matchMedia` — ADR 0078 decision 6 is an explicit switch,
 * not the OS preference (plan §1 "No visible switch").
 *
 * The script's text is extracted from the real `index.html` and run with `node:vm` in a minimal
 * sandbox rather than parsed — the assertion is on what the script *does*, not on its source text
 * (beyond B1, B8, B9, which are necessarily textual).
 */

const html = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");

/** The first plain `<script>` (no `type` attribute) in `index.html`, its text content. */
function extractBootScript(): string {
  const scriptTags = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const plain = scriptTags.find((m) => !/\btype\s*=/.test(m[1]));
  if (!plain) throw new Error("no plain <script> (without a type attribute) found in index.html");
  return plain[2];
}

type Sandbox = {
  window: { localStorage: unknown };
  document: { documentElement: { setAttribute: (name: string, value: string) => void } };
};

/** Run the boot script in a fresh sandbox and return the `data-theme` value it set (or undefined). */
function runBootScript(getStorage: () => { getItem: (key: string) => string | null }): string | undefined {
  let themeSet: string | undefined;
  const sandbox: Sandbox = {
    window: {
      get localStorage() {
        return getStorage();
      },
    },
    document: {
      documentElement: {
        setAttribute: (name, value) => {
          if (name === "data-theme") themeSet = value;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractBootScript(), sandbox);
  return themeSet;
}

function storageWithValue(value: string | null): { getItem: (key: string) => string | null } {
  return { getItem: (key: string) => (key === "bms.theme" ? value : null) };
}

describe("F3.65a theme boot script", () => {
  it("B1 index.html has a plain <script> (no type) before <script type=\"module\">", () => {
    const plainIndex = html.indexOf("<script>");
    const moduleIndex = html.indexOf('<script type="module"');
    expect(plainIndex).toBeGreaterThanOrEqual(0);
    expect(moduleIndex).toBeGreaterThanOrEqual(0);
    expect(plainIndex).toBeLessThan(moduleIndex);
  });

  it('B2 "dark" sets data-theme="dark"', () => {
    expect(runBootScript(() => storageWithValue("dark"))).toBe("dark");
  });

  it('B3 "light" sets data-theme="light"', () => {
    expect(runBootScript(() => storageWithValue("light"))).toBe("light");
  });

  it("B4 a missing key sets data-theme=\"light\"", () => {
    expect(runBootScript(() => storageWithValue(null))).toBe("light");
  });

  it('B5 "Dark", "system" and "" all set data-theme="light"', () => {
    expect(runBootScript(() => storageWithValue("Dark"))).toBe("light");
    expect(runBootScript(() => storageWithValue("system"))).toBe("light");
    expect(runBootScript(() => storageWithValue(""))).toBe("light");
  });

  it("B6 a throwing getItem sets data-theme=\"light\"", () => {
    const throwing = {
      getItem: () => {
        throw new Error("boom");
      },
    };
    expect(runBootScript(() => throwing)).toBe("light");
  });

  it("B7 a throwing window.localStorage getter sets data-theme=\"light\"", () => {
    expect(
      runBootScript(() => {
        throw new Error("no storage");
      }),
    ).toBe("light");
  });

  it("B8 the script uses neither matchMedia nor prefers-color-scheme", () => {
    const script = extractBootScript();
    expect(script).not.toMatch(/matchMedia/);
    expect(script).not.toMatch(/prefers-color-scheme/);
  });

  it('B9 the storage key literal is exactly "bms.theme"', () => {
    expect(extractBootScript()).toMatch(/["']bms\.theme["']/);
  });
});
