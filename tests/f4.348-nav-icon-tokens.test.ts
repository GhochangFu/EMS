import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LUCIDE_SHAPES } from "../apps/web/src/components/widgets/mimic-symbol-libraries/lucide.generated";
import { NAV_ICONS } from "../apps/web/src/layouts/shells/navigation-model";
import { ICON_TOKENS } from "../apps/web/src/lib/design";
import { parseTokenBlocks } from "./support/colour-tokens";
import { parseDesignBlocks } from "./support/design-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.348` (ADR 0118 Amendment 4 decision 4, plan I4/I5) — each design system draws its own
 * navigation-icon line: every design block (both variants) sets the four `--icon-*` tokens to the
 * amendment's values, and the one `.nav-icon` rule reads only those tokens (no literal size, stroke
 * or colour; the colour is the element's `currentColor`).
 */
const CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");

const EXPECTED: Record<string, [string, string, string, string]> = {
  base: ["16px", "1.75", "round", "round"],
  "enterprise-flat": ["16px", "1.5", "round", "round"],
  "swiss-grid": ["16px", "2.25", "square", "miter"],
  "bento-ops": ["18px", "2", "round", "round"],
  "control-room-dark": ["20px", "2", "square", "miter"],
};

describe("F4.348 the navigation-icon tokens", () => {
  const blocks = parseDesignBlocks(CSS, new Set(parseTokenBlocks(CSS).light.keys()));
  const all: Array<[string, Map<string, string>]> = [
    ["base", blocks.base.neumorphic],
    ["base", blocks.base.flat],
    ...[...blocks.designs].flatMap(([name, v]) => [
      [name, v.neumorphic!] as [string, Map<string, string>],
      [name, v.flat!] as [string, Map<string, string>],
    ]),
  ];

  it("I5 every design block sets the four tokens to Amendment 4's values", () => {
    expect(all).toHaveLength(10);
    for (const [name, block] of all) {
      expect(ICON_TOKENS.map((t) => block.get(t)?.trim()), name).toEqual(EXPECTED[name]);
    }
  });

  it("I4 the .nav-icon rule reads only the four tokens", () => {
    const body = /\.nav-icon\s*\{([^}]*)\}/.exec(CSS.replace(/\/\*[\s\S]*?\*\//g, " "))?.[1] ?? "";
    expect(body).toMatch(/width:\s*var\(--icon-size\)/);
    expect(body).toMatch(/height:\s*var\(--icon-size\)/);
    expect(body).toMatch(/stroke-width:\s*var\(--icon-stroke\)/);
    expect(body).toMatch(/stroke-linecap:\s*var\(--icon-linecap\)/);
    expect(body).toMatch(/stroke-linejoin:\s*var\(--icon-linejoin\)/);
    expect(body).not.toMatch(/#[0-9a-f]{3,8}|rgb|\d+px|color/i);
  });
});

describe("F4.348 no line end erases a dot", () => {
  it("I5b no design block uses a butt cap while a navigation icon draws a dot as a zero-length stroke", () => {
    // Lucide draws a dot as a 0.01-unit segment (`h.01`, `v.01`) that only a round or square cap makes
    // visible; under `butt` the window dots of `building` and the "!" of `shield-alert` vanish.
    const dotted = Object.values(NAV_ICONS).filter((icon) =>
      LUCIDE_SHAPES[`lucide:${icon}`].some(([, attrs]) => /[hv]-?\.01\b/.test((attrs as { d?: string }).d ?? "")),
    );
    expect(dotted.length, "the dot scan is live").toBeGreaterThan(0);
    const caps = [...CSS.matchAll(/--icon-linecap:\s*([a-z]+);/g)].map((m) => m[1]);
    expect(caps).toHaveLength(10);
    expect(caps.filter((cap) => cap === "butt")).toEqual([]);
  });
});
