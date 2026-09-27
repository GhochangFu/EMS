import { describe, expect, it } from "vitest";

import { contrastRatio, deltaE2000, parseTokenBlocks, resolveTailwindShade } from "./support/colour-tokens";

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
