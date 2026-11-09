import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { DESIGN_TOKENS, LEADING_STEPS, SHADOW_TOKENS, SPACE_STEPS, TEXT_STEPS } from "../apps/web/src/lib/design";
import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { parseTokenBlocks } from "./support/colour-tokens";
import { missingTokens, parseDesignBlocks } from "./support/design-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 1a — the design tokens (ADR 0118 decision 3, plan
 * `docs/plans/f4.341-selectable-design-systems.md` D1–D4, D8).
 *
 *  - **DT1** `theme.fontSize` is exactly `3xs 2xs xs … 6xl`, each step a token.
 *  - **DT2** `theme.padding`, `theme.gap` and `theme.space` read `--space-N` for steps 1…8 and
 *    their midpoints for the half steps; every other step is Tailwind's default.
 *  - **DT3** the `nexus-soft` blocks equal Tailwind's defaults and today's weight, case and
 *    tracking — the no-pixel proof. Weight, case and tracking utilities read tokens (D8).
 *  - **DT4** `parseDesignBlocks` returns the full token set for the base in both variants and
 *    fails closed.
 *  - **DT5** the compiled utilities read the tokens (Tailwind run on a fixed content string).
 */

const WEB = join(repoRoot, "apps/web");
const INDEX_CSS = readFileSync(join(WEB, "src/index.css"), "utf8");
const ROLES = new Set(parseTokenBlocks(INDEX_CSS).light.keys());
const webRequire = createRequire(join(WEB, "package.json"));

type FontSize = string | [string, { lineHeight: string }];
type SpacingFn = (helpers: { theme: (path: string) => Record<string, string> }) => Record<string, string>;
const tailwindConfig = (await import(pathToFileURL(join(WEB, "tailwind.config.js")).href)).default as {
  corePlugins: Record<string, boolean>;
  theme: {
    fontSize: Record<string, FontSize>;
    padding: SpacingFn;
    gap: SpacingFn;
    space: SpacingFn;
    extend: { fontWeight: Record<string, string>; letterSpacing: Record<string, string> };
  };
};
const defaultTheme = webRequire("tailwindcss/defaultTheme") as {
  fontSize: Record<string, [string, { lineHeight: string }]>;
  spacing: Record<string, string>;
  fontWeight: Record<string, string>;
  letterSpacing: Record<string, string>;
};

const SPACE_MIDPOINTS: Record<string, string> = {
  "0.5": "calc(var(--space-1) / 2)",
  "1.5": "calc((var(--space-1) + var(--space-2)) / 2)",
  "2.5": "calc((var(--space-2) + var(--space-3)) / 2)",
};

describe("F4.341 DT1 the type scale emits tokens", () => {
  it("DT1 theme.fontSize has exactly the twelve steps, smallest first", () => {
    expect(Object.keys(tailwindConfig.theme.fontSize)).toEqual([...TEXT_STEPS]);
  });

  it("DT1 3xs and 2xs set the size only; xs…6xl set the size and its line height", () => {
    const fs = tailwindConfig.theme.fontSize;
    expect(fs["3xs"]).toBe("var(--text-3xs)");
    expect(fs["2xs"]).toBe("var(--text-2xs)");
    for (const k of LEADING_STEPS) {
      expect(fs[k], k).toEqual([`var(--text-${k})`, { lineHeight: `var(--leading-${k})` }]);
    }
  });
});

describe("F4.341 DT2 padding, gap and space emit tokens", () => {
  for (const key of ["padding", "gap", "space"] as const) {
    it(`DT2 theme.${key}`, () => {
      const scale = tailwindConfig.theme[key]({ theme: () => defaultTheme.spacing });
      expect(Object.keys(scale).sort()).toEqual(Object.keys(defaultTheme.spacing).sort());
      for (const [step, value] of Object.entries(scale)) {
        const n = Number(step);
        if ((SPACE_STEPS as readonly number[]).includes(n)) expect(value, step).toBe(`var(--space-${n})`);
        else if (SPACE_MIDPOINTS[step]) expect(value, step).toBe(SPACE_MIDPOINTS[step]);
        else expect(value, step).toBe(defaultTheme.spacing[step]);
      }
    });
  }
});

const blocks = parseDesignBlocks(INDEX_CSS, ROLES);

/** The tokens that both nexus-soft variants share: type, weight, case, spacing. */
function typeAndSpaceExpectations(): Record<string, string> {
  const out: Record<string, string> = {
    "--text-3xs": "10px",
    "--text-2xs": "11px",
    "--weight-bold": defaultTheme.fontWeight.bold,
    "--weight-semibold": defaultTheme.fontWeight.semibold,
    "--caps-transform": "uppercase",
    "--caps-tracking-wide": defaultTheme.letterSpacing.wide,
    "--caps-tracking-wider": defaultTheme.letterSpacing.wider,
    "--text-wall-min": "16px",
  };
  for (const k of LEADING_STEPS) {
    out[`--text-${k}`] = defaultTheme.fontSize[k][0];
    out[`--leading-${k}`] = defaultTheme.fontSize[k][1].lineHeight;
  }
  for (const n of SPACE_STEPS) out[`--space-${n}`] = defaultTheme.spacing[String(n)];
  return out;
}

describe("F4.341 DT3 nexus-soft is today's look (the no-pixel proof)", () => {
  for (const variant of ["neumorphic", "flat"] as const) {
    it(`DT3 the ${variant} block's type, weight, case and spacing equal Tailwind's defaults and today's values`, () => {
      const block = blocks.base[variant];
      for (const [token, expected] of Object.entries(typeAndSpaceExpectations())) {
        expect(block.get(token), token).toBe(expected);
      }
    });
  }

  it("DT3 the neumorphic shape tokens are today's radii and grounds", () => {
    expect(Object.fromEntries([...blocks.base.neumorphic].filter(([k]) => /^--(radius|card|page|button)-/.test(k)))).toEqual({
      "--radius-card": "18px",
      "--radius-card-sm": "12px",
      "--radius-well": "14px",
      "--radius-control": "10px",
      "--radius-button": "12px",
      "--radius-pill": "9999px",
      "--card-ground": "rgb(var(--canvas))",
      "--page-ground": "rgb(var(--canvas))",
      "--button-edge": "rgb(var(--ink-faint))",
    });
  });

  it("DT3 the flat shape tokens are today's flat utilities (rounded-lg, rounded, bg-surface, border-line)", () => {
    expect(Object.fromEntries([...blocks.base.flat].filter(([k]) => /^--(radius|card|page|button)-/.test(k)))).toEqual({
      "--radius-card": "0.5rem",
      "--radius-card-sm": "0.25rem",
      "--radius-well": "0.25rem",
      "--radius-control": "0.25rem",
      "--radius-button": "0.25rem",
      "--radius-pill": "0",
      "--card-ground": "rgb(var(--surface))",
      "--page-ground": "rgb(var(--canvas))",
      "--button-edge": "rgb(var(--ink-faint))",
    });
  });

  it("DT3 bold and semibold, wide and wider read the weight and tracking tokens (D8)", () => {
    expect(tailwindConfig.theme.extend.fontWeight).toEqual({ bold: "var(--weight-bold)", semibold: "var(--weight-semibold)" });
    expect(tailwindConfig.theme.extend.letterSpacing).toEqual({
      wide: "var(--caps-tracking-wide)",
      wider: "var(--caps-tracking-wider)",
    });
  });

  it("DT3 the core textTransform plugin is off, so the token-driven uppercase is the only one", () => {
    expect(tailwindConfig.corePlugins).toEqual({ textTransform: false });
  });

  it("DT3 the mutation is caught: a changed --text-xs no longer equals Tailwind's default", () => {
    const mutated = parseDesignBlocks(INDEX_CSS.replace("--text-xs: 0.75rem;", "--text-xs: 0.8rem;"), ROLES);
    expect(mutated.base.neumorphic.get("--text-xs")).not.toBe(defaultTheme.fontSize.xs[0]);
  });
});

describe("F4.341 DT4 the design-block parser", () => {
  it("DT4 the base defines every design token in both variants", () => {
    expect(missingTokens(blocks.base.neumorphic)).toEqual([]);
    expect(missingTokens(blocks.base.flat)).toEqual([]);
    expect([...blocks.base.neumorphic.keys()].sort()).toEqual([...DESIGN_TOKENS].sort());
    expect([...blocks.base.flat.keys()].sort()).toEqual([...DESIGN_TOKENS].sort());
  });

  it("DS1 every design system's blocks that exist are complete, and each is a contract name (PR 11: all five)", () => {
    for (const [name, variants] of blocks.designs) {
      expect((DESIGN_SYSTEMS as readonly string[]).includes(name), name).toBe(true);
      expect(variants.neumorphic, `${name} neumorphic`).toBeDefined();
      expect(variants.flat, `${name} flat`).toBeDefined();
      expect(missingTokens(variants.neumorphic!), `${name} neumorphic`).toEqual([]);
      expect(missingTokens(variants.flat!), `${name} flat`).toEqual([]);
    }
    expect(blocks.designs.size).toBeGreaterThan(0);
  });

  it("DT4 the shadow tokens stay out of the design blocks", () => {
    for (const t of SHADOW_TOKENS) expect(blocks.base.neumorphic.has(t)).toBe(false);
  });

  const BASE = "html {\n  --text-xs: 0.75rem;\n}";
  const tamper = (from: string, to: string): string => {
    expect(INDEX_CSS).toContain(from);
    return INDEX_CSS.replace(from, to);
  };

  it("DT4 throws on a missing token", () => {
    expect(() => parseDesignBlocks(tamper("  --space-8: 2rem;\n", ""), ROLES)).toThrow(/missing --space-8/);
  });

  it("DT4 throws on a duplicate block", () => {
    expect(() => parseDesignBlocks(`${INDEX_CSS}\n${BASE}\n`, ROLES)).toThrow(/duplicate block: html/);
  });

  it("DT4 throws on a colour role in a design block", () => {
    expect(() => parseDesignBlocks(tamper("  --space-8: 2rem;\n", "  --space-8: 2rem;\n  --accent: 0 0 0;\n"), ROLES)).toThrow(
      /sets the colour role --accent/,
    );
  });

  it("DT4 throws on a value with #, color-mix( or backdrop-filter", () => {
    for (const bad of ["#ffffff", "color-mix(in srgb, red, blue)", "backdrop-filter"]) {
      expect(() => parseDesignBlocks(tamper("--card-ground: rgb(var(--canvas));", `--card-ground: ${bad};`), ROLES)).toThrow(
        /forbidden value/,
      );
    }
  });

  it("DT4 throws on an unknown token and on an unknown html selector", () => {
    expect(() => parseDesignBlocks(tamper("  --space-8: 2rem;\n", "  --space-8: 2rem;\n  --space-9: 3rem;\n"), ROLES)).toThrow(
      /not a design token/,
    );
    expect(() => parseDesignBlocks(`${INDEX_CSS}\nhtml[data-desing="x"] {\n}\n`, ROLES)).toThrow(/unknown design-block selector/);
  });

  it("DT4 reads a design system's pair by name", () => {
    const css = `${INDEX_CSS}\nhtml[data-design="x"] {\n  --space-1: 4px;\n}\nhtml[data-design="x"][data-surface="flat"] {\n  --space-1: 4px;\n}\n`;
    const parsed = parseDesignBlocks(css, ROLES).designs.get("x");
    expect(parsed?.neumorphic?.get("--space-1")).toBe("4px");
    expect(parsed?.flat?.get("--space-1")).toBe("4px");
  });
});

describe("F4.341 DT5 the compiled utilities read the tokens", () => {
  it("DT5 Tailwind emits token-driven type, spacing, weight, case and tracking", async () => {
    // `postcss` and `tailwindcss` are `apps/web` dependencies, loaded through its own resolution.
    type Processor = { process: (css: string, opts: { from: undefined }) => Promise<{ css: string }> };
    const postcss = webRequire("postcss") as (plugins: unknown[]) => Processor;
    const tailwind = webRequire("tailwindcss") as (config: unknown) => unknown;
    const content = "text-3xs text-2xs text-xs text-6xl p-1 px-1.5 gap-2.5 space-y-8 gap-0.5 p-10 font-bold font-semibold uppercase normal-case tracking-wide tracking-wider";
    const result = await postcss([
      tailwind({ ...tailwindConfig, content: [{ raw: content }], corePlugins: { ...tailwindConfig.corePlugins, preflight: false } }),
    ]).process("@tailwind utilities;", { from: undefined });
    const css = result.css.replace(/\s+/g, " ");
    const rule = (sel: string): string => new RegExp(`${sel.replace(/[.\\[\]]/g, (c) => `\\${c}`)} \\{ ([^}]*)\\}`).exec(css)?.[1].trim().replace(/;?$/, ";") ?? "";
    expect(rule(".text-3xs")).toBe("font-size: var(--text-3xs);");
    expect(rule(".text-2xs")).toBe("font-size: var(--text-2xs);");
    expect(rule(".text-xs")).toBe("font-size: var(--text-xs); line-height: var(--leading-xs);");
    expect(rule(".text-6xl")).toBe("font-size: var(--text-6xl); line-height: var(--leading-6xl);");
    expect(rule(".p-1")).toBe("padding: var(--space-1);");
    expect(rule(".px-1\\.5")).toBe(
      "padding-left: calc((var(--space-1) + var(--space-2)) / 2); padding-right: calc((var(--space-1) + var(--space-2)) / 2);",
    );
    expect(rule(".gap-2\\.5")).toBe("gap: calc((var(--space-2) + var(--space-3)) / 2);");
    expect(rule(".gap-0\\.5")).toBe("gap: calc(var(--space-1) / 2);");
    expect(rule(".p-10")).toBe("padding: 2.5rem;");
    expect(rule(".font-bold")).toBe("font-weight: var(--weight-bold);");
    expect(rule(".font-semibold")).toBe("font-weight: var(--weight-semibold);");
    expect(rule(".uppercase")).toBe("text-transform: var(--caps-transform);");
    expect(rule(".normal-case")).toBe("text-transform: none;");
    expect(rule(".tracking-wide")).toBe("letter-spacing: var(--caps-tracking-wide);");
    expect(rule(".tracking-wider")).toBe("letter-spacing: var(--caps-tracking-wider);");
    expect(css).toContain("margin-top: calc(var(--space-8) * calc(1 - var(--tw-space-y-reverse)))");
  });
});
