import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PRs 8–11 (plan D3, §8 risk 2) — a design system's explicit rules keep one class of
 * specificity. Every `index.css` rule whose selector names `data-design`, other than the token and
 * shadow blocks (`html[data-design=…]…` on their own), is `:where(html[data-design="<name>"…])`
 * followed by one `.surface-…` class (and at most a `:where(…)` state or a pseudo-element), so it
 * wins over the base and flat rules by source order and a call-site utility still wins over it.
 */
const CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const DESIGN_RULE = /^:where\(html\[data-design="([a-z-]+)"\](?:\[data-surface="flat"\])?\) \.surface-[a-z-]+(?::where\(:[a-z-]+\)|::(?:before|after))?$/;

function designSelectors(): string[] {
  return [...CSS.matchAll(/([^{}]*)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) => s.trim())
    .filter((s) => s.includes("data-design") && !s.startsWith("html"));
}

describe("F4.341 a design system's explicit rules", () => {
  it("DS2 every design-scoped rule is :where(html[data-design]) + one surface class, for a contract name", () => {
    const bad = designSelectors().filter((s) => {
      const m = DESIGN_RULE.exec(s);
      return !m || !(DESIGN_SYSTEMS as readonly string[]).includes(m[1]);
    });
    expect(bad).toEqual([]);
  });

  it("DS2 the scan is live: it finds the explicit rules, and catches an unwrapped one", () => {
    expect(designSelectors().length).toBeGreaterThan(0);
    expect(DESIGN_RULE.test('html[data-design="bento-ops"] .surface-raised')).toBe(false);
    expect(DESIGN_RULE.test(':where(html[data-design="bento-ops"]) .surface-raised .x')).toBe(false);
  });
});
