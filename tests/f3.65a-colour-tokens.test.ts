import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { blankComments } from "./support/pending-button-scan";
import { repoRoot, walk } from "./support/source-scan";
import { channelsToHex, contrastRatio, deltaE2000, parseTokenBlocks, resolveTailwindShade } from "./support/colour-tokens";

/**
 * `F3.65a` — the colour maths support (`tests/support/colour-tokens.ts`) that every later gate in
 * this row (`tests/f3.65a-colour-contrast.test.ts`, `tests/f3.65a-colour-mapping-table.test.ts`)
 * builds on: WCAG 2.x contrast, CIEDE2000, and resolving a Tailwind shade name against the real
 * `tailwindcss/colors` package. T1–T6 check the maths against the values `docs/plans/f3.65a-colour-tokens.md`
 * §0/§2.4 measured independently before the plan's gate; T7 onward (added in U2) check the token
 * file itself.
 */
describe("F3.65a: colour maths support", () => {
  it("T1 contrastRatio(white, bms-green) is 3.19 — why on-accent is white in light", () => {
    expect(contrastRatio("#FFFFFF", "#00A651")).toBeCloseTo(3.19, 2);
  });

  it("T2 contrastRatio(ink-3, sheet) is 4.25 — the Nexus value the plan adjusted for ink-faint", () => {
    expect(contrastRatio("#78849A", "#1A222D")).toBeCloseTo(4.25, 2);
  });

  it("T3 contrastRatio(#8F1F1B, sheet) is 1.82 — an ADR check reproduced", () => {
    expect(contrastRatio("#8F1F1B", "#1A222D")).toBeCloseTo(1.82, 2);
  });

  it("T4 deltaE2000(red-200, red-300) is 9.59", () => {
    expect(deltaE2000("#FECACA", "#FCA5A5")).toBeCloseTo(9.59, 2);
  });

  it("T4 deltaE2000(gray-600, bms-muted) is 1.10 — the gray-600 → ink-muted merge", () => {
    expect(deltaE2000("#4B5563", "#4A5464")).toBeCloseTo(1.1, 2);
  });

  it("T5 resolveTailwindShade resolves a stock Tailwind shade lowercase", () => {
    expect(resolveTailwindShade("gray-200")).toBe("#e5e7eb");
  });

  it("T5 resolveTailwindShade resolves a bms.* palette shade at its declared case", () => {
    expect(resolveTailwindShade("bms-green")).toBe("#00A651");
  });

  it("T6 parseTokenBlocks throws naming the role missing from the dark block", () => {
    const css = `
:root {
  --canvas: 242 244 247; /* #F2F4F7 */
  --surface: 255 255 255; /* #FFFFFF */
}
:root[data-theme="dark"] {
  --canvas: 20 27 37; /* #141B25 */
}
`;
    expect(() => parseTokenBlocks(css)).toThrow(/surface/);
  });

  it("T6 parseTokenBlocks throws on a malformed token line", () => {
    const css = `
:root {
  --canvas: not-a-colour;
}
:root[data-theme="dark"] {
  --canvas: 20 27 37;
}
`;
    expect(() => parseTokenBlocks(css)).toThrow(/malformed/);
  });

  it("T6 parseTokenBlocks throws on a second dark block rather than reading the first", () => {
    const css = `
:root {
  --canvas: 242 244 247;
}
:root[data-theme="dark"] {
  --canvas: 20 27 37;
}
:root[data-theme="dark"] {
  --canvas: 185 28 28;
}
`;
    expect(() => parseTokenBlocks(css)).toThrow(/2 ':root\[data-theme="dark"\]/);
  });

  it("T6 parseTokenBlocks throws on a second :root block rather than reading the first", () => {
    const css = `
:root {
  --canvas: 242 244 247;
}
:root {
  --canvas: 185 28 28;
}
:root[data-theme="dark"] {
  --canvas: 20 27 37;
}
`;
    expect(() => parseTokenBlocks(css)).toThrow(/2 ':root \{/);
  });
});

const INDEX_CSS_PATH = join(repoRoot, "apps/web/src/index.css");
const TAILWIND_CONFIG_PATH = join(repoRoot, "apps/web/tailwind.config.js");

/**
 * The 40 roles of `docs/plans/f3.65a-colour-tokens.md` §2.2, light and dark hex, exact, plus the
 * 41st role `simulated-ink` (owner ruling 2026-09-28, ADR 0078 Amendment 1 §1, added after the
 * plan's gate — see `tests/support/colour-role-map.ts`'s docblock for the derivation). The 40 §2.2 rows are the
 * plan's table transcribed, not derived; `simulated-ink` is not in the plan and is derived here.
 * T9/T10 are the check that `index.css` matches this table.
 */
const ROLE_HEX: Record<string, { light: string; dark: string }> = {
  canvas: { light: "#F2F4F7", dark: "#141B25" },
  surface: { light: "#FFFFFF", dark: "#1A222D" },
  well: { light: "#F9FAFB", dark: "#212B37" },
  "well-deep": { light: "#F3F4F6", dark: "#283341" },
  line: { light: "#E5E7EB", dark: "#2E3A49" },
  "line-strong": { light: "#D1D5DB", dark: "#3D4A5B" },
  ink: { light: "#1A2230", dark: "#E8ECF1" },
  "ink-muted": { light: "#4A5464", dark: "#A7B2C0" },
  "ink-faint": { light: "#64748B", dark: "#8791A5" },
  "ink-hint": { light: "#9CA3AF", dark: "#78849A" },
  "neutral-ink": { light: "#374151", dark: "#8E9CB2" },
  accent: { light: "#00A651", dark: "#3DCD58" },
  "accent-strong": { light: "#007C3C", dark: "#65D77A" },
  chrome: { light: "#1D2430", dark: "#0F1620" },
  "chrome-nav": { light: "#007C3C", dark: "#007C3C" },
  "on-dark": { light: "#FFFFFF", dark: "#FFFFFF" },
  "on-accent": { light: "#FFFFFF", dark: "#0F1620" },
  focus: { light: "#00A651", dark: "#3DCD58" },
  scrim: { light: "#000000", dark: "#000000" },
  critical: { light: "#DC2626", dark: "#DC2626" },
  "critical-ink-soft": { light: "#DC2626", dark: "#E76A6A" },
  "critical-ink": { light: "#B91C1C", dark: "#E86A6A" },
  "critical-ink-strong": { light: "#991B1B", dark: "#EC8585" },
  "critical-wash": { light: "#FEF2F2", dark: "#371515" },
  "critical-wash-strong": { light: "#FEE2E2", dark: "#4A1C1C" },
  "critical-line": { light: "#FECACA", dark: "#6B2E2E" },
  "critical-line-strong": { light: "#FCA5A5", dark: "#8D3535" },
  "critical-on-dark": { light: "#F87171", dark: "#F87171" },
  warning: { light: "#F59E0B", dark: "#F59E0B" },
  "warning-ink": { light: "#78350F", dark: "#EB8F5C" },
  "warning-wash": { light: "#FFFBEB", dark: "#372B15" },
  "warning-wash-strong": { light: "#FEF3C7", dark: "#4A391C" },
  "warning-line": { light: "#FDE68A", dark: "#6B542E" },
  "warning-on-dark": { light: "#FBBF24", dark: "#FBBF24" },
  "ok-ink": { light: "#064E3B", dark: "#0DAD83" },
  "ok-wash": { light: "#ECFDF5", dark: "#15372E" },
  info: { light: "#0EA5E9", dark: "#0EA5E9" },
  "info-ink": { light: "#075985", dark: "#0C98E3" },
  "info-wash": { light: "#F0F9FF", dark: "#152D37" },
  "info-line": { light: "#BAE6FD", dark: "#2E586B" },
  // The 41st role (owner ruling 2026-09-28, ADR 0078 Amendment 1 §1): the "simulated"
  // provenance marker in `lib/value-provenance.ts` (`text-violet-700`) keeps its own colour
  // rather than folding into `ink-faint`. Light is Tailwind violet-700 exact; dark is D3-derived (hue/sat kept, lightness
  // raised in 0.5% steps) to clear 4.5:1 on sheet, paper and `well` (the declared pairs below) —
  // 5.13 / 5.54 / 4.59.
  "simulated-ink": { light: "#6D28D9", dark: "#A67DE8" },
};

/**
 * `apps/web/tailwind.config.js` itself, imported (it is an ES module; `apps/web/package.json` has
 * `"type": "module"`), so T11 checks the object Tailwind reads rather than the file's text.
 */
const tailwindConfig = (await import(pathToFileURL(TAILWIND_CONFIG_PATH).href)).default as {
  darkMode: unknown;
  theme: {
    colors: Record<string, unknown>;
    extend: {
      colors?: Record<string, unknown>;
      borderColor?: Record<string, unknown>;
      ringOffsetColor?: Record<string, unknown>;
    };
  };
};

/**
 * The three CSS keywords `theme.colors` keeps beside the roles once the stock palette is gone
 * (`F3.65c` D9): `bg-transparent`, `border-current` and `fill-inherit`-style utilities still need
 * a key. They are held to exact values by their own T11 case and skipped by the role cases.
 */
const COLOUR_KEYWORDS: Record<string, string> = { transparent: "transparent", current: "currentColor", inherit: "inherit" };

/**
 * Every leaf of `theme.colors` other than the three keywords, keyed by the class stem Tailwind
 * builds from its path (`ink.muted` → `ink-muted`, `critical.ink.DEFAULT` → `critical-ink`). A
 * stem reached twice is kept under its first path and recorded as a clash.
 */
function flattenColours(node: Record<string, unknown>, path: string[] = []): Map<string, { path: string; value: unknown }> {
  const out = new Map<string, { path: string; value: unknown }>();
  for (const [key, value] of Object.entries(node)) {
    if (path.length === 0 && key in COLOUR_KEYWORDS) continue;
    const next = [...path, key];
    if (value !== null && typeof value === "object") {
      for (const [stem, leaf] of flattenColours(value as Record<string, unknown>, next)) {
        out.set(out.has(stem) ? `${stem} (clash: ${leaf.path})` : stem, leaf);
      }
      continue;
    }
    const stem = next.filter((k) => k !== "DEFAULT").join("-");
    out.set(out.has(stem) ? `${stem} (clash: ${next.join(".")})` : stem, { path: next.join("."), value });
  }
  return out;
}

const configColourLeaves = flattenColours(tailwindConfig.theme.colors);

/** Tailwind's stock palette, from the installed package; only its keys are read (see T16c). */
const stockColours = createRequire(join(repoRoot, "apps/web/package.json"))("tailwindcss/colors") as Record<string, unknown>;

describe("F3.65a: the token file (index.css) and the Tailwind mapping", () => {
  const css = () => readFileSync(INDEX_CSS_PATH, "utf8");

  it("T7 the light block defines exactly the 40 role names of §2.2 plus simulated-ink (41 total)", () => {
    expect([...parseTokenBlocks(css()).light.keys()].sort()).toEqual(Object.keys(ROLE_HEX).sort());
  });

  it("T7 the dark block defines exactly the 40 role names of §2.2 plus simulated-ink (41 total)", () => {
    expect([...parseTokenBlocks(css()).dark.keys()].sort()).toEqual(Object.keys(ROLE_HEX).sort());
  });

  it("T8 every declared channel value is an integer 0–255", () => {
    const { light, dark } = parseTokenBlocks(css());
    const bad: string[] = [];
    for (const [theme, map] of [["light", light], ["dark", dark]] as const) {
      for (const [role, channels] of map) {
        if (!channels.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)) bad.push(`${theme} ${role}: ${channels.join(" ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("T9 every light value equals §2.2's light hex", () => {
    const { light } = parseTokenBlocks(css());
    const mismatches = Object.entries(ROLE_HEX)
      .map(([role, { light: hex }]) => [role, hex, light.get(role)] as const)
      .filter(([, hex, channels]) => !channels || channelsToHex(channels).toLowerCase() !== hex.toLowerCase())
      .map(([role, hex, channels]) => `${role}: ${channels ? channelsToHex(channels) : "missing"}, expected ${hex}`);
    expect(mismatches).toEqual([]);
  });

  it("T10 every dark value equals §2.2's dark hex", () => {
    const { dark } = parseTokenBlocks(css());
    const mismatches = Object.entries(ROLE_HEX)
      .map(([role, { dark: hex }]) => [role, hex, dark.get(role)] as const)
      .filter(([, hex, channels]) => !channels || channelsToHex(channels).toLowerCase() !== hex.toLowerCase())
      .map(([role, hex, channels]) => `${role}: ${channels ? channelsToHex(channels) : "missing"}, expected ${hex}`);
    expect(mismatches).toEqual([]);
  });

  it("T11 the role stems of theme.colors (outside the three keywords) are exactly the 41 roles", () => {
    expect([...configColourLeaves.keys()].sort()).toEqual(Object.keys(ROLE_HEX).sort());
  });

  it("T11 each role stem maps to exactly its own rgb(var(--<role>) / <alpha-value>)", () => {
    const wrong = [...configColourLeaves]
      .filter(([stem, { value }]) => value !== `rgb(var(--${stem}) / <alpha-value>)`)
      .map(([stem, { path, value }]) => `${path} (${stem}): ${String(value)}`);
    expect(wrong).toEqual([]);
  });

  it("T11 no colour leaf outside the three keywords holds a literal colour", () => {
    const literal = [...configColourLeaves.values()]
      .filter(({ value }) => typeof value !== "string" || !/^rgb\(var\(--[a-z][a-z0-9-]*\) \/ <alpha-value>\)$/.test(value))
      .map(({ path, value }) => `${path}: ${String(value)}`);
    expect(literal).toEqual([]);
  });

  it("T11 theme.colors keeps transparent, current and inherit at their CSS keywords", () => {
    const kept = Object.fromEntries(Object.keys(COLOUR_KEYWORDS).map((k) => [k, tailwindConfig.theme.colors[k]]));
    expect(kept).toEqual(COLOUR_KEYWORDS);
  });

  // F3.65c D9: the roles replace Tailwind's colours rather than extend them, so no stock family
  // (`gray`, `red`, `white` …) and no `bms.*` shade can emit a class. T16a–c are one claim each.
  it("T16a tailwind.config.js has no theme.extend.colors", () => {
    expect(tailwindConfig.theme.extend.colors).toBeUndefined();
  });

  it("T16b theme.colors has no bms key", () => {
    expect(Object.keys(tailwindConfig.theme.colors)).not.toContain("bms");
  });

  it("T16c theme.colors has no stock Tailwind colour family key", () => {
    // `in` reads the key only: v3's deprecated families (`lightBlue` …) warn when their value is read.
    const stock = Object.keys(tailwindConfig.theme.colors).filter((k) => !(k in COLOUR_KEYWORDS) && k in stockColours);
    expect(stock).toEqual([]);
  });

  // F3.65b review: Tailwind 3.4 preflight sets `border-color: theme('borderColor.DEFAULT')`
  // (stock `#E5E7EB`) on every element, and `--tw-ring-offset-color` defaults to `#fff`, so a bare
  // `border` / `divide-y` / `ring-offset-2` stayed light in dark. Both defaults now read a role;
  // `line` and `surface` are exactly those two light values, so no light pixel moves. The ring
  // offset default has no `<alpha-value>`: the ring plugin copies it into the variable unsubstituted.
  it("T11 theme.extend.borderColor.DEFAULT reads --line", () => {
    expect(tailwindConfig.theme.extend.borderColor?.DEFAULT).toBe("rgb(var(--line) / <alpha-value>)");
  });

  it("T11 theme.extend.ringOffsetColor.DEFAULT reads --surface, with no <alpha-value> placeholder", () => {
    expect(tailwindConfig.theme.extend.ringOffsetColor?.DEFAULT).toBe("rgb(var(--surface))");
  });

  it('T11 tailwind.config.js sets darkMode to ["selector", \'[data-theme="dark"]\']', () => {
    expect(tailwindConfig.darkMode).toEqual(["selector", '[data-theme="dark"]']);
  });

  it("T12 :root carries color-scheme: light", () => {
    const rootBlock = /:root\s*\{([^}]*)\}/.exec(css());
    expect(rootBlock).not.toBeNull();
    expect(rootBlock![1]).toMatch(/color-scheme:\s*light\s*;/);
  });

  it('T12 :root[data-theme="dark"] carries color-scheme: dark', () => {
    const darkBlock = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css());
    expect(darkBlock).not.toBeNull();
    expect(darkBlock![1]).toMatch(/color-scheme:\s*dark\s*;/);
  });

  // Independent of `parseTokenBlocks`, which throws on a second block: this case must still name
  // the stray declaration when the token file is malformed. Role names come from `ROLE_HEX`.
  it("T14 every --<role>: declaration in apps/web/src/**/*.css sits inside index.css's :root or dark block", () => {
    const roles = new Set(Object.keys(ROLE_HEX));
    const cssFiles = walk(join(repoRoot, "apps/web/src")).filter((f) => f.endsWith(".css"));
    const outside: string[] = [];
    for (const full of cssFiles) {
      const text = blankComments(readFileSync(full, "utf8"));
      const file = relative(repoRoot, full).split("\\").join("/");
      const spans: [number, number][] = [];
      if (file === "apps/web/src/index.css") {
        for (const re of [/:root\s*\{[^}]*\}/, /:root\[data-theme="dark"\]\s*\{[^}]*\}/]) {
          const m = re.exec(text);
          if (m) spans.push([m.index, m.index + m[0].length]);
        }
      }
      for (const m of text.matchAll(/(?<![\w-])--([a-z][a-z0-9-]*)\s*:/g)) {
        if (!roles.has(m[1])) continue;
        if (spans.some(([a, b]) => m.index >= a && m.index < b)) continue;
        outside.push(`${file}:${text.slice(0, m.index).split("\n").length} --${m[1]}`);
      }
    }
    expect(outside).toEqual([]);
  });

  // F3.65b review: `leaflet.css` paints the popup `background: white`, and `world-map.tsx`'s popup
  // content uses role inks that turn light in dark (1.19:1). The rule lives outside the two token
  // blocks (T14 is about role declarations only) and sets the background alone, so no light pixel
  // moves. It wins on source order: `leaflet.css` bundles before `index.css`.
  it("T15 index.css paints the Leaflet popup and its tip from --surface", () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.leaflet-popup-content-wrapper\s*,\s*\.leaflet-popup-tip\s*\{([^}]*)\}/.exec(text);
    expect(rule?.[1] ?? "").toMatch(/(^|;|\s)background:\s*rgb\(var\(--surface\)\)\s*;/);
  });

  it("T13 index.css holds no # hex literal outside a comment", () => {
    const withoutComments = css().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  // F3.65c U7 — the Leaflet popup close glyph is `leaflet.css`'s own `#757575` (`:hover`/`:focus`
  // `#585858`), a sibling of T15 for the same reason: outside the two token blocks, same
  // specificity/source-order win over `leaflet.css`. Split into T17a/T17b (F3.65c review): one
  // `expect` per `it()`, so a broken base rule cannot hide a broken hover/focus rule behind it.
  it("T17a index.css paints the Leaflet popup close button from --ink-faint", () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const base = /\.leaflet-container\s+a\.leaflet-popup-close-button\s*\{([^}]*)\}/.exec(text);
    expect(base?.[1] ?? "").toMatch(/(^|;|\s)color:\s*rgb\(var\(--ink-faint\)\)\s*;/);
  });

  it("T17b index.css paints the close button's hover/focus state from --ink", () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//g, "");
    const hover =
      /\.leaflet-container\s+a\.leaflet-popup-close-button:hover\s*,\s*\.leaflet-container\s+a\.leaflet-popup-close-button:focus\s*\{([^}]*)\}/.exec(
        text,
      );
    expect(hover?.[1] ?? "").toMatch(/(^|;|\s)color:\s*rgb\(var\(--ink\)\)\s*;/);
  });
});
