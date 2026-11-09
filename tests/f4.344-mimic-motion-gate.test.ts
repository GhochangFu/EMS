import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";

/**
 * `F4.344` (ADR 0120 decisions 3, 4, 7 and 8; plan `docs/plans/f4.344-mimic-glyph-state-motion.md`
 * T1.2, R6, R9) — the mimic glyph motion's safety gate. jsdom computes no media query and no
 * `animation-name`, so the reduced-motion and flash-rate proofs live here, over the Tailwind
 * config and the CSS it compiles.
 *
 *  - **MG1** `theme.extend.animation` is exactly the four `mimic-*` utilities; each is
 *    `<keyframe> <N>s <timing> infinite`, at 1 / 1.6 / 0.8 / 3.2 s, every cycle ≥ 0.8 s (decision 8,
 *    WCAG 2.3.1), and names its own keyframe, which exists.
 *  - **MG2** every keyframe step sets only `opacity` and/or `transform` — colour never moves
 *    (decision 3).
 *  - **MG3** the class literals in `MIMIC_GLYPH_MOTION_CLASS` compile to rules that sit only inside
 *    `@media (prefers-reduced-motion: no-preference)` (decision 4); the pulse keyframe scales to 1.06.
 */

const WEB = join(repoRoot, "apps/web");
const webRequire = createRequire(join(WEB, "package.json"));

type Keyframes = Record<string, Record<string, Record<string, string>>>;
const tailwindConfig = (await import(pathToFileURL(join(WEB, "tailwind.config.js")).href)).default as {
  corePlugins: Record<string, boolean>;
  theme: { extend: { keyframes?: Keyframes; animation?: Record<string, string> } };
};

const ANIMATION = /^(mimic-[a-z-]+) (\d+(?:\.\d+)?)s \S+ infinite$/;
const EXPECTED_SECONDS: Record<string, number> = {
  "mimic-blink": 1,
  "mimic-pulse": 1.6,
  "mimic-pulse-fast": 0.8,
  "mimic-breathe": 3.2,
};

/** The keyframe each utility must name (`pulse` and `pulse-fast` share one, plan R6). */
const EXPECTED_KEYFRAME: Record<string, string> = {
  "mimic-blink": "mimic-blink",
  "mimic-pulse": "mimic-pulse",
  "mimic-pulse-fast": "mimic-pulse",
  "mimic-breathe": "mimic-breathe",
};

/** The four class literals inside `MIMIC_GLYPH_MOTION_CLASS = { … }` in `lib/mimic.ts`. */
function motionClassLiterals(): string[] {
  const source = readFileSync(join(WEB, "src/lib/mimic.ts"), "utf8");
  const body = /export const MIMIC_GLYPH_MOTION_CLASS[^=]*= \{([^}]*)\};/.exec(source)?.[1];
  expect(body, "MIMIC_GLYPH_MOTION_CLASS literal not found in lib/mimic.ts").toBeDefined();
  const values = [...(body ?? "").matchAll(/:\s*"([^"]+)",/g)].map((m) => m[1]!);
  expect(values).toHaveLength(4);
  return values;
}

/**
 * The CSS split into what sits inside every `head … }` block (braces balanced — Tailwind nests the
 * `@keyframes` inside the media query) and everything else.
 */
function splitMedia(css: string, head: string): { inside: string; outside: string } {
  let inside = "";
  let outside = "";
  let at = 0;
  for (let start = css.indexOf(head); start !== -1; start = css.indexOf(head, at)) {
    outside += css.slice(at, start);
    let depth = 1;
    let i = start + head.length;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    inside += css.slice(start + head.length, i - 1);
    at = i;
  }
  return { inside, outside: outside + css.slice(at) };
}

describe("F4.344 MG1 the motion utilities are slow enough", () => {
  it("MG1 extend.animation is the four mimic utilities, each ≥ 0.8 s and naming a real keyframe", () => {
    const animation = tailwindConfig.theme.extend.animation ?? {};
    const keyframes = tailwindConfig.theme.extend.keyframes ?? {};
    expect(Object.keys(animation).sort()).toEqual(Object.keys(EXPECTED_SECONDS).sort());
    for (const [name, value] of Object.entries(animation)) {
      const match = ANIMATION.exec(value);
      expect(match, `${name}: "${value}"`).not.toBeNull();
      const seconds = Number(match![2]);
      expect(seconds, name).toBe(EXPECTED_SECONDS[name]);
      expect(seconds, `${name} cycles faster than 0.8 s`).toBeGreaterThanOrEqual(0.8);
      expect(match![1], `${name} names the wrong keyframe`).toBe(EXPECTED_KEYFRAME[name]);
      expect(Object.keys(keyframes), name).toContain(match![1]);
    }
  });
});

describe("F4.344 MG2 the keyframes move opacity and transform only", () => {
  it("MG2 no keyframe step sets a colour", () => {
    const keyframes = tailwindConfig.theme.extend.keyframes ?? {};
    expect(Object.keys(keyframes).length).toBeGreaterThan(0);
    for (const [name, steps] of Object.entries(keyframes)) {
      for (const [step, props] of Object.entries(steps)) {
        for (const prop of Object.keys(props)) {
          expect(["opacity", "transform"], `${name} ${step} sets ${prop}`).toContain(prop);
        }
      }
    }
  });
});

describe("F4.344 MG3 reduced motion always wins", () => {
  it("MG3 every compiled animate-mimic rule sits inside prefers-reduced-motion: no-preference", async () => {
    type Processor = { process: (css: string, opts: { from: undefined }) => Promise<{ css: string }> };
    const postcss = webRequire("postcss") as (plugins: unknown[]) => Processor;
    const tailwind = webRequire("tailwindcss") as (config: unknown) => unknown;
    const content = motionClassLiterals().join(" ");
    const result = await postcss([
      tailwind({ ...tailwindConfig, content: [{ raw: content }], corePlugins: { ...tailwindConfig.corePlugins, preflight: false } }),
    ]).process("@tailwind utilities;", { from: undefined });
    const css = result.css.replace(/\s+/g, " ");

    const { inside, outside } = splitMedia(css, "@media (prefers-reduced-motion: no-preference) {");

    for (const name of ["mimic-blink", "mimic-pulse", "mimic-pulse-fast", "mimic-breathe"]) {
      expect(inside, name).toContain(`.motion-safe\\:animate-${name} {`);
    }
    expect(outside).not.toMatch(/animate-mimic-/);
    expect(outside).not.toMatch(/animation: mimic-/);

    const pulse = /@keyframes mimic-pulse \{(.*?\}) *\}/.exec(css)?.[1] ?? "";
    expect(pulse).toContain("scale(1.06)");
  });
});
