import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 1, plan S6) — the `swiss-grid` and `bento-ops` skins of
 * the sidebar are CSS over tokens only. Every rule under `:where(html[data-design="swiss-grid"|
 * "bento-ops"])` that targets the sidebar or its items names no colour literal (a hex, an `rgb(`
 * of numbers, a named colour) and no raw length outside the 3px rule; the selected item paints
 * `ink` and never `accent` (A5 permits ink; the DT4 and A5 gates stay green on their own).
 */
const CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");

function skinRules(design: string): Map<string, string> {
  const rules = new Map<string, string>();
  for (const m of CSS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim().replace(/\s+/g, " ");
    if (!selector.startsWith(`:where(html[data-design="${design}"])`)) continue;
    if (!/\.surface-(sidebar|nav-item)/.test(selector)) continue;
    rules.set(selector, m[2]!);
  }
  return rules;
}

describe.each(["swiss-grid", "bento-ops"])("F4.346 the %s sidebar skin", (design) => {
  const rules = skinRules(design);

  it("S6 skins the sidebar, its items and the selected item", () => {
    const selectors = [...rules.keys()].join("\n");
    expect(selectors).toMatch(/\.surface-sidebar\b/);
    expect(selectors).toMatch(/\.surface-nav-item(?!-)/);
    expect(selectors).toMatch(/\.surface-nav-item-selected\b/);
  });

  it("S6 reads only tokens: no colour literal, no accent", () => {
    for (const [selector, body] of rules) {
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body, selector).not.toMatch(/rgba?\(\s*\d/);
      expect(body, selector).not.toMatch(/:\s*(white|black|transparent|red|green|blue)\b/);
      expect(body, selector).not.toMatch(/accent/);
    }
  });

  it("S6 the selected item paints ink", () => {
    const selected = [...rules].filter(([s]) => /\.surface-nav-item-selected\b/.test(s)).map(([, b]) => b).join(";");
    expect(selected).toMatch(/background-color:\s*rgb\(var\(--ink\)\)/);
  });
});

describe("F4.346 the skins' shapes (ADR 0118 Amendment 3 decision 1)", () => {
  it("S6 swiss-grid: square items on surface, a 3px ink rule", () => {
    const body = [...skinRules("swiss-grid").values()].join(";");
    expect(body).toMatch(/background-color:\s*rgb\(var\(--surface\)\)/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-control\)/);
    const block = /html\[data-design="swiss-grid"\] \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(block).toMatch(/--radius-control:\s*0;/);
    expect(block).toMatch(/--radius-card:\s*0;/);
    expect(body).toMatch(/3px/);
    expect(body).toMatch(/border-color:\s*rgb\(var\(--ink\)\)/);
  });

  it("S6 bento-ops: pill items on the page ground", () => {
    const body = [...skinRules("bento-ops").values()].join(";");
    expect(body).toMatch(/background-color:\s*var\(--page-ground\)/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });
});
