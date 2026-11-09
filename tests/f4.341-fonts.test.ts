import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTokenBlocks } from "./support/colour-tokens";
import { parseDesignBlocks, type DesignBlock } from "./support/design-tokens";
import { gsubFeatureTags, woff2TabularFigures } from "./support/opentype-features";
import { repoRoot, walk } from "./support/source-scan";

/**
 * `F4.341` PR 6 (ADR 0118 decision 5, Amendment 1 A2/A6, plan P3) — the self-hosted fonts.
 *
 *  - **F1** no Google Fonts reference anywhere in `apps/web` (some sites have no internet).
 *  - **F2** the Plex Sans package's metadata lists a `wdth` axis covering 85–100 (A2: the
 *    condensed width comes from it).
 *  - **F3** every `--font-*` token names only the four self-hosted families (and their generic
 *    fallbacks); `--font-mono` is Plex Mono in every block.
 *  - **F4** at most two families across a design system's `--font-body`, `--font-head` and
 *    `--font-num`. `--font-mono` is the code face, the same in every design system (F3), and is
 *    not one a design system chooses.
 *  - **F5** `--font-body` and `--font-num` never name Bricolage Grotesque; `--font-body` never names
 *    Archivo (display faces set headings, and for Archivo large figures, only).
 *  - **F6** every `--font-num` face has tabular figures, proved from its WOFF2: the ten default
 *    digits share one advance width, or GSUB offers `tnum` (which the `font-num` utility turns on).
 *    A synthetic GSUB without `tnum` and a proportional-digit face are the negative fixtures.
 */

const WEB = join(repoRoot, "apps/web");
const webRequire = createRequire(join(WEB, "package.json"));
const INDEX_CSS = readFileSync(join(WEB, "src/index.css"), "utf8");
const ROLES = new Set(parseTokenBlocks(INDEX_CSS).light.keys());
const BLOCKS = parseDesignBlocks(INDEX_CSS, ROLES);

/** Every design block, by `<design system> <variant>`. */
function allBlocks(): Array<[string, DesignBlock]> {
  const out: Array<[string, DesignBlock]> = [
    ["nexus-soft neumorphic", BLOCKS.base.neumorphic],
    ["nexus-soft flat", BLOCKS.base.flat],
  ];
  for (const [name, v] of BLOCKS.designs) {
    if (v.neumorphic) out.push([`${name} neumorphic`, v.neumorphic]);
    if (v.flat) out.push([`${name} flat`, v.flat]);
  }
  return out;
}

/** The family names of a `font-family` value, unquoted. */
const families = (value: string): string[] => value.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));

const SELF_HOSTED = ["IBM Plex Sans Variable", "IBM Plex Mono", "Archivo Variable", "Bricolage Grotesque Variable"] as const;
/** Fallbacks a stack may name after its face: the static Plex name and the generic families. */
const FALLBACKS = new Set(["IBM Plex Sans", "system-ui", "sans-serif", "ui-monospace", "monospace"]);
const FONT_TOKENS = ["--font-body", "--font-head", "--font-num", "--font-mono"] as const;

/** The WOFF2 a face's `@fontsource` CSS (imported in `main.tsx`) serves for Latin, default instance. */
const FACE_FILE: Record<(typeof SELF_HOSTED)[number], string> = {
  "IBM Plex Sans Variable": "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-standard-normal.woff2",
  "IBM Plex Mono": "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "Archivo Variable": "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
  "Bricolage Grotesque Variable": "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
};
const faceBytes = (face: (typeof SELF_HOSTED)[number]): Buffer => readFileSync(webRequire.resolve(FACE_FILE[face]));

describe("F4.341 the self-hosted fonts", () => {
  it("F1 apps/web references no Google Fonts host", () => {
    const files = [join(WEB, "index.html"), ...walk(join(WEB, "src")).filter((f) => /\.(tsx?|css|html)$/.test(f))];
    const hits = files.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    expect(files.length).toBeGreaterThan(100);
  });

  it("F2 the Plex Sans package lists a wdth axis covering 85–100", () => {
    const meta = JSON.parse(readFileSync(webRequire.resolve("@fontsource-variable/ibm-plex-sans/metadata.json"), "utf8")) as {
      variable: Record<string, { min: string; max: string }>;
    };
    expect(Number(meta.variable.wdth.min)).toBeLessThanOrEqual(85);
    expect(Number(meta.variable.wdth.max)).toBeGreaterThanOrEqual(100);
  });

  it("F3 every --font-* token names a self-hosted face first and only allowed fallbacks; --font-mono is Plex Mono", () => {
    const bad: string[] = [];
    for (const [where, block] of allBlocks()) {
      for (const token of FONT_TOKENS) {
        const [face, ...rest] = families(block.get(token) ?? "");
        if (!(SELF_HOSTED as readonly string[]).includes(face)) bad.push(`${where} ${token}: ${face}`);
        for (const f of rest) if (!FALLBACKS.has(f)) bad.push(`${where} ${token}: fallback ${f}`);
      }
      if (families(block.get("--font-mono") ?? "")[0] !== "IBM Plex Mono") bad.push(`${where} --font-mono is not Plex Mono`);
    }
    expect(bad).toEqual([]);
  });

  it("F4 a design system sets at most two families across body, head and numbers", () => {
    const over = allBlocks()
      .map(([where, block]) => [where, new Set(["--font-body", "--font-head", "--font-num"].map((t) => families(block.get(t) ?? "")[0]))] as const)
      .filter(([, faces]) => faces.size > 2)
      .map(([where, faces]) => `${where}: ${[...faces].join(", ")}`);
    expect(over).toEqual([]);
  });

  it("F5 the display faces never set body text or table figures", () => {
    const bad: string[] = [];
    for (const [where, block] of allBlocks()) {
      const body = families(block.get("--font-body") ?? "")[0];
      const num = families(block.get("--font-num") ?? "")[0];
      if (/Bricolage/.test(body) || /Archivo/.test(body)) bad.push(`${where} --font-body: ${body}`);
      if (/Bricolage/.test(num)) bad.push(`${where} --font-num: ${num}`);
    }
    expect(bad).toEqual([]);
  });

  it("F6 every --font-num face has tabular figures (equal default digits, or tnum)", () => {
    const faces = new Set(allBlocks().map(([, block]) => families(block.get("--font-num") ?? "")[0] as (typeof SELF_HOSTED)[number]));
    expect(faces.size).toBeGreaterThan(0);
    for (const face of faces) {
      expect(existsSync(webRequire.resolve(FACE_FILE[face])), face).toBe(true);
      expect(woff2TabularFigures(faceBytes(face)).tabular, face).toBe(true);
    }
  });

  it("F6 the font-num utility turns tabular figures on, for a face that needs tnum", async () => {
    const { pathToFileURL } = await import("node:url");
    const config = (await import(pathToFileURL(join(WEB, "tailwind.config.js")).href)).default as { plugins: unknown[] };
    const postcss = webRequire("postcss") as (plugins: unknown[]) => { process: (css: string, o: { from: undefined }) => Promise<{ css: string }> };
    const tailwind = webRequire("tailwindcss") as (c: unknown) => unknown;
    const { css } = await postcss([tailwind({ ...config, content: [{ raw: "font-num font-condensed" }], corePlugins: { textTransform: false, preflight: false } })]).process(
      "@tailwind utilities;",
      { from: undefined },
    );
    expect(css.replace(/\s+/g, " ")).toContain(".font-num { font-family: var(--font-num); font-variant-numeric: tabular-nums }");
    expect(css.replace(/\s+/g, " ")).toContain(".font-condensed { font-family: var(--font-body); font-stretch: 85% }");
  });

  it("F6 the proof is live: Plex Sans is tabular by its digits, Archivo by tnum, a proportional face without tnum is not", () => {
    expect(woff2TabularFigures(faceBytes("IBM Plex Sans Variable")).how).toBe("default-digits");
    expect(woff2TabularFigures(faceBytes("Archivo Variable")).how).toBe("tnum");
    // The negative fixture: a GSUB whose FeatureList holds only `liga` (version 1.0, one feature).
    const gsub = Buffer.alloc(20);
    gsub.writeUInt16BE(1, 0);
    gsub.writeUInt16BE(10, 6);
    gsub.writeUInt16BE(1, 10);
    gsub.write("liga", 12, "latin1");
    expect(gsubFeatureTags(gsub)).toEqual(["liga"]);
    expect(gsubFeatureTags(gsub)).not.toContain("tnum");
    // Bricolage's default digits are proportional; only its tnum makes it tabular.
    const bricolage = woff2TabularFigures(faceBytes("Bricolage Grotesque Variable"));
    expect(new Set(bricolage.advances).size).toBeGreaterThan(1);
  });
});
