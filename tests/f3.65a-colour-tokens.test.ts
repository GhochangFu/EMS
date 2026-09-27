import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";
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
});

const INDEX_CSS_PATH = join(repoRoot, "apps/web/src/index.css");
const TAILWIND_CONFIG_PATH = join(repoRoot, "apps/web/tailwind.config.js");

/**
 * The 40 roles of `docs/plans/f3.65a-colour-tokens.md` §2.2, light and dark hex, exact. This is
 * the plan's table transcribed, not derived — T9/T10 are the check that `index.css` matches it.
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
};

describe("F3.65a: the token file (index.css) and the Tailwind mapping", () => {
  const css = () => readFileSync(INDEX_CSS_PATH, "utf8");
  const config = () => readFileSync(TAILWIND_CONFIG_PATH, "utf8");

  it("T7 both blocks define exactly the 40 role names of §2.2", () => {
    const { light, dark } = parseTokenBlocks(css());
    const expected = Object.keys(ROLE_HEX).sort();
    expect([...light.keys()].sort()).toEqual(expected);
    expect([...dark.keys()].sort()).toEqual(expected);
  });

  it("T8 every declared channel value is an integer 0–255", () => {
    const { light, dark } = parseTokenBlocks(css());
    for (const channels of [...light.values(), ...dark.values()]) {
      for (const c of channels) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });

  it("T9 every light value equals §2.2's light hex", () => {
    const { light } = parseTokenBlocks(css());
    for (const [role, { light: hex }] of Object.entries(ROLE_HEX)) {
      expect(channelsToHex(light.get(role)!).toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  it("T10 every dark value equals §2.2's dark hex", () => {
    const { dark } = parseTokenBlocks(css());
    for (const [role, { dark: hex }] of Object.entries(ROLE_HEX)) {
      expect(channelsToHex(dark.get(role)!).toLowerCase()).toBe(hex.toLowerCase());
    }
  });

  it("T11 tailwind.config.js maps every role through rgb(var(--role) / <alpha-value>)", () => {
    const text = config();
    for (const role of Object.keys(ROLE_HEX)) {
      expect(text, `missing mapping for role "${role}"`).toContain(`rgb(var(--${role}) / <alpha-value>)`);
    }
  });

  it('T11 tailwind.config.js sets darkMode: ["selector", \'[data-theme="dark"]\']', () => {
    expect(config()).toContain('darkMode: ["selector", \'[data-theme="dark"]\']');
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

  it("T13 index.css holds no # hex literal outside a comment", () => {
    const withoutComments = css().replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
