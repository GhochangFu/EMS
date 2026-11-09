import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { webColourSourceFiles } from "./support/colour-scan";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 1a — the type and spacing zero gate (ADR 0118 decision 3, plan
 * `docs/plans/f4.341-selectable-design-systems.md` §5 PR 1a).
 *
 * Since `tailwind.config.js` maps every named text and spacing step to a design token (DT1, DT2),
 * a "raw" size is an **arbitrary** utility or an inline literal: those are the values a design
 * system cannot reach.
 *
 *  - **Z1** no arbitrary `text-[<size>]` utility (a hard zero since PR 1c; PR 1a measured 417
 *    and PRs 1b/1c swept them to the named steps, 7–9px SVG text to the `fontSize` attribute).
 *  - **Z2** arbitrary padding, gap, `space-*` and `leading-*` utilities: zero.
 *  - **Z3** no inline `fontSize:` / `padding:` / `gap:` literal (ECharts options, CodeMirror's
 *    theme): since PR 4 chart text reads `chartType()` and CodeMirror's theme `var(--…)`. An SVG `<text fontSize={…}>` attribute is drawing geometry (decision 15) and is not
 *    counted; `Z3_EXEMPT` names the two non-type sites with their reason.
 *  - **Z4** the `surface-*` rules of `index.css` hold no `font-size`, `padding`, `gap`,
 *    `border-radius` or `min-height` literal: each reads a design token.
 *  - **Z5** `index.css` holds no `backdrop-filter` (ADR 0118 Amendment 1 A1).
 */

const rel = (full: string): string => relative(repoRoot, full).split("\\").join("/");

const ARBITRARY_TEXT_SIZE = /\btext-\[(?:\d|\.\d|length:|calc\(|var\(|clamp\()/g;
const ARBITRARY_SPACING = /(?<![\w-])-?(?:p[xytblrse]?|gap(?:-[xy])?|space-[xy]|leading)-\[/g;
/** A number, an array, or a string that does not read a token (`"var(--…)"` is a token read). */
const INLINE_LITERAL = /\b(?:fontSize|padding|gap)\s*:\s*(?:[-\d[]|["'`](?!var\(--))/g;

/** Inline literals that are not type or spacing of the page, with the reason. Exact. */
const Z3_EXEMPT: Record<string, { count: number; reason: string }> = {
  "apps/web/src/components/dashboards/dashboard-canvas.tsx": {
    count: 1,
    reason: "the grid gap is GAP_PX, the constant the tile-placement arithmetic measures against",
  },
  "apps/web/src/components/world-map.tsx": {
    count: 1,
    reason: "Leaflet's fitBounds viewport padding in map pixels, not a CSS property",
  },
};

function scriptSources(): { file: string; text: string }[] {
  return webColourSourceFiles()
    .filter((f) => /\.tsx?$/.test(f))
    .map((full) => ({ file: rel(full), text: blankComments(readFileSync(full, "utf8")) }));
}

function countsBy(pattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { file, text } of scriptSources()) {
    const n = [...text.matchAll(pattern)].length;
    if (n > 0) out[file] = n;
  }
  return out;
}

const sorted = (r: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

describe("F4.341 the type and spacing zero gate", () => {
  it("Z1 no arbitrary text size: every size is a named step that reads a token", () => {
    expect(countsBy(ARBITRARY_TEXT_SIZE)).toEqual({});
  });

  it("Z1 the scan is live: it counts an arbitrary size and ignores a named step or a colour", () => {
    expect([..."text-[11px] text-[10.5px] text-xs text-ink text-[length:12px]".matchAll(ARBITRARY_TEXT_SIZE)].length).toBe(3);
  });

  it("Z2 no arbitrary padding, gap, space or leading utility", () => {
    const hits = Object.keys(countsBy(ARBITRARY_SPACING));
    expect(hits).toEqual([]);
  });

  it("Z2 the scan is live: it finds p-[…], gap-x-[…], space-y-[…], leading-[…] and not inset-[…]", () => {
    expect([..."p-[3px] px-[1rem] gap-x-[5px] space-y-[2px] leading-[1.1] -mt-[2px] inset-[2px]".matchAll(ARBITRARY_SPACING)].length).toBe(5);
  });

  it("Z3 no inline fontSize / padding / gap literal but the Z3_EXEMPT sites (a hard zero since PR 4)", () => {
    const expected = Object.fromEntries(Object.entries(Z3_EXEMPT).map(([f, e]) => [f, e.count]));
    expect(sorted(countsBy(INLINE_LITERAL))).toEqual(sorted(expected));
  });

  it("Z3 the scan is live: it counts an option literal and not an SVG attribute or a token read", () => {
    const sample = 'axisLabel: { fontSize: 10 }, padding: "4px", <text fontSize={12}>, fontSize: type.xs, padding: "var(--space-2)"';
    expect([...sample.matchAll(INLINE_LITERAL)].length).toBe(2);
  });
});

const INDEX_CSS = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const CSS = INDEX_CSS.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));
const SIZED = /(?:^|[;{\s])(font-size|padding|gap|border-radius|min-height)\s*:\s*([^;]+);/g;
/** A value that reads a token: `var(--x)`, or a `calc(…)` built on one. */
const TOKEN_VALUE = /^(?:var\(--[a-z0-9-]+\)|calc\([^;]*var\(--[a-z0-9-]+\)[^;]*\))$/;

function literalSizes(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (!/\.surface-/.test(m[1])) continue;
    for (const d of m[2].matchAll(SIZED)) {
      if (!TOKEN_VALUE.test(d[2].trim())) out.push(`${m[1].trim()} ${d[1]}: ${d[2].trim()}`);
    }
  }
  return out;
}

describe("F4.341 index.css reads the tokens", () => {
  it("Z4 no surface-* rule holds a font-size, padding, gap, border-radius or min-height literal", () => {
    expect(literalSizes(CSS)).toEqual([]);
  });

  it("Z4 the scan is live: a literal radius in a surface rule is found, a token read is not", () => {
    expect(literalSizes(".surface-x { border-radius: 12px; padding: var(--space-1); gap: calc(var(--space-1) / 2); }")).toEqual([
      ".surface-x border-radius: 12px",
    ]);
  });

  it("Z4 the scan reads the real surface rules", () => {
    expect([...CSS.matchAll(/\.surface-[a-z-]+\s*\{/g)].length).toBeGreaterThan(15);
  });

  it("Z5 index.css holds no backdrop-filter", () => {
    expect(CSS).not.toMatch(/backdrop-filter/);
  });
});
