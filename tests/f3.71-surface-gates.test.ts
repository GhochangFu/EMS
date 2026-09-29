import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { SURFACE_STORAGE_KEY } from "../apps/web/src/lib/surface";
import { classStrings, webColourSourceFiles } from "./support/colour-scan";
import { parseTokenBlocks } from "./support/colour-tokens";
import { blankComments } from "./support/pending-button-scan";
import { repoRoot } from "./support/source-scan";

/**
 * `F3.71` — the surface style's gates (ADR 0085 decision 6, plan
 * `docs/plans/f3.71-neumorphic-surface-style.md` §4).
 *
 *  - **S1–S9, K1** the boot script in `apps/web/index.html` sets `data-surface` on `<html>` from
 *    `localStorage["bms.surface"]`: `"flat"` only for the exact value, `"neumorphic"` for anything
 *    else, a throwing storage included; its read is independent of the theme read. The script is
 *    run with `node:vm` in a sandbox, like `f3.65a-theme-boot.test.ts`.
 *  - **T1–T3** the shadow tokens live in exactly two `index.css` blocks keyed on
 *    `:not([data-surface="flat"])`, declare the same names, and hold no colour but
 *    `rgb(var(--<role>) / <alpha>)` of a real role — so the palette stays the 41 roles.
 *  - **V2–V6** the vocabulary: no `data-surface` arbitrary variant in a class; no class string mixes
 *    a `surface-*` token with the colour utilities it replaces; every used `surface-*` class has a
 *    neumorphic and a flat rule, every defined one is used; the chrome carries none.
 *
 * `V1` (no spelled-out card or field is left) is in `f3.71-surface-card-ratchet.test.ts`.
 */

const INDEX_HTML = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");
const INDEX_CSS_PATH = join(repoRoot, "apps/web/src/index.css");
const INDEX_CSS = readFileSync(INDEX_CSS_PATH, "utf8");
const APP_SHELL = "apps/web/src/layouts/app-shell.tsx";

const rel = (full: string): string => relative(repoRoot, full).split("\\").join("/");
const cssWithoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, " "));

// ---------------------------------------------------------------------------------------------
// The boot script
// ---------------------------------------------------------------------------------------------

/** The first plain `<script>` (no `type`), as `f3.65a-theme-boot.test.ts` extracts it. */
function bootScript(): string {
  const plain = [...INDEX_HTML.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find((m) => !/\btype\s*=/.test(m[1]));
  if (!plain) throw new Error("no plain <script> (without a type attribute) found in index.html");
  return plain[2];
}

type Storage = { getItem: (key: string) => string | null };

/** Run the boot script in a fresh sandbox; the attributes it set on `<html>`. */
function runBoot(getStorage: () => Storage): Record<string, string> {
  const set: Record<string, string> = {};
  const sandbox = {
    window: {
      get localStorage() {
        return getStorage();
      },
    },
    document: { documentElement: { setAttribute: (name: string, value: string) => void (set[name] = value) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(bootScript(), sandbox);
  return set;
}

function storing(values: Record<string, string>): Storage {
  return { getItem: (key) => (key in values ? values[key] : null) };
}

const surfaceFor = (value: string | null): string | undefined =>
  runBoot(() => storing(value === null ? {} : { "bms.surface": value }))["data-surface"];

describe("F3.71 the surface boot script", () => {
  it("S1 the boot script sets data-surface as well as data-theme", () => {
    expect(Object.keys(runBoot(() => storing({}))).sort()).toEqual(["data-surface", "data-theme"]);
  });

  it('S2 "flat" sets data-surface="flat"', () => {
    expect(surfaceFor("flat")).toBe("flat");
  });

  it('S3 "neumorphic" sets data-surface="neumorphic"', () => {
    expect(surfaceFor("neumorphic")).toBe("neumorphic");
  });

  it('S4 a missing key sets data-surface="neumorphic" (the default)', () => {
    expect(surfaceFor(null)).toBe("neumorphic");
  });

  it('S5a "Flat" sets "neumorphic" (the match is exact)', () => {
    expect(surfaceFor("Flat")).toBe("neumorphic");
  });

  it('S5b "system" sets "neumorphic"', () => {
    expect(surfaceFor("system")).toBe("neumorphic");
  });

  it('S5c "" sets "neumorphic"', () => {
    expect(surfaceFor("")).toBe("neumorphic");
  });

  it('S6 a throwing getItem sets "neumorphic"', () => {
    const throwing: Storage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(runBoot(() => throwing)["data-surface"]).toBe("neumorphic");
  });

  it('S7 a throwing window.localStorage getter sets "neumorphic"', () => {
    const set = runBoot(() => {
      throw new Error("SecurityError");
    });
    expect(set["data-surface"]).toBe("neumorphic");
  });

  it("S8 a storage that throws only for bms.surface still sets data-theme from bms.theme", () => {
    const partial: Storage = {
      getItem: (key) => {
        if (key === "bms.surface") throw new Error("denied");
        return key === "bms.theme" ? "dark" : null;
      },
    };
    expect(runBoot(() => partial)["data-theme"]).toBe("dark");
  });

  it('S9 the script names "bms.surface" once and reads no media query', () => {
    const text = bootScript();
    expect({
      key: text.split('"bms.surface"').length - 1,
      matchMedia: /matchMedia/.test(text),
      prefers: /prefers-color-scheme/.test(text),
    }).toEqual({ key: 1, matchMedia: false, prefers: false });
  });

  it("K1 SURFACE_STORAGE_KEY is the second localStorage key the boot script reads", () => {
    const keys = [...INDEX_HTML.matchAll(/localStorage\.getItem\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    expect(keys[1]).toBe(SURFACE_STORAGE_KEY);
  });
});

// ---------------------------------------------------------------------------------------------
// The shadow tokens
// ---------------------------------------------------------------------------------------------

const LIGHT_SHADOW_SELECTOR = ':root:not([data-surface="flat"])';
const DARK_SHADOW_SELECTOR = ':root[data-theme="dark"]:not([data-surface="flat"])';

/** Every block whose selector ends in `:not([data-surface="flat"])`, by selector. */
function shadowBlocks(css: string): { selector: string; body: string }[] {
  return [...cssWithoutComments(css).matchAll(/([^{}]*?:not\(\[data-surface="flat"\]\))\s*\{([^}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]*);/g)) out.set(m[1], m[2].trim());
  return out;
}

const ROLES = new Set(parseTokenBlocks(INDEX_CSS).light.keys());

/** A shadow value with every `rgb(var(--<role>) / <alpha>)` of a real role removed. */
function withoutRoleColours(value: string): string {
  return value.replace(/rgb\(var\(--([a-z0-9-]+)\) \/ (0|1|0?\.\d+)\)/g, (whole, role: string) =>
    ROLES.has(role) ? " " : whole,
  );
}

describe("F3.71 the shadow tokens", () => {
  it("T1 exactly the light and the dark shadow block exist", () => {
    expect(shadowBlocks(INDEX_CSS).map((b) => b.selector)).toEqual([LIGHT_SHADOW_SELECTOR, DARK_SHADOW_SELECTOR]);
  });

  it("T1 both shadow blocks declare the same --shadow-* names", () => {
    const [light, dark] = shadowBlocks(INDEX_CSS).map((b) => [...declarations(b.body).keys()].sort());
    expect(dark).toEqual(light);
  });

  it("T1 the shadow blocks declare only --shadow-* names", () => {
    const names = shadowBlocks(INDEX_CSS).flatMap((b) => [...declarations(b.body).keys()]);
    expect(names.filter((n) => !n.startsWith("--shadow-"))).toEqual([]);
  });

  it("T2 a shadow value holds no colour but rgb(var(--<role>) / <alpha>)", () => {
    const leftovers = shadowBlocks(INDEX_CSS)
      .flatMap((b) => [...declarations(b.body)].map(([name, value]) => ({ name, rest: withoutRoleColours(value) })))
      .filter(({ rest }) => rest.replace(/-?\d*\.?\d+px|\b0\b|\binset\b|,|\s/g, "") !== "")
      .map(({ name, rest }) => `${name}: ${rest.trim()}`);
    expect(leftovers).toEqual([]);
  });

  it("T2 the scan is live: a literal colour in a shadow value is a leftover", () => {
    expect(withoutRoleColours("2px 2px 5px rgb(0 0 0 / 0.15)").replace(/-?\d*\.?\d+px|\b0\b|\binset\b|,|\s/g, "")).not.toBe("");
  });

  it("T3 no --shadow-* is declared outside the two shadow blocks", () => {
    const outside: string[] = [];
    for (const full of webColourSourceFiles().filter((f) => f.endsWith(".css"))) {
      const text = cssWithoutComments(readFileSync(full, "utf8")).replace(
        /[^{}]*?:not\(\[data-surface="flat"\]\)\s*\{[^}]*\}/g,
        (s) => s.replace(/[^\n]/g, " "),
      );
      for (const m of text.matchAll(/--shadow-[a-z0-9-]+\s*:/g)) {
        outside.push(`${rel(full)}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(outside).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------------------------

const FLAT_SCOPE = ':where([data-surface="flat"])';
const SURFACE_TOKEN = /^surface-[a-z]+(?:-[a-z]+)*$/;
/** A class token with its variants (`hover:`, `md:`, `!`) stripped. */
const bare = (token: string): string => token.replace(/^(?:[^\s:]*:)*!?/, "");
const REPLACED = /^(?:bg-surface|bg-well|bg-well-deep|border-line|border-line-strong|shadow(?:-sm|-md|-lg|-xl|-2xl|-inner)?)$/;

/** The `.ts` / `.tsx` web sources outside specs and tests, comment-blanked. */
function scriptSources(): { file: string; text: string }[] {
  return webColourSourceFiles()
    .filter((f) => /\.tsx?$/.test(f))
    .map((full) => ({ file: rel(full), text: blankComments(readFileSync(full, "utf8")) }));
}

/** Every class-string token set in the web sources, with its file and line. */
function classTokenSets(): { at: string; tokens: string[] }[] {
  return scriptSources().flatMap(({ file, text }) =>
    classStrings(text).map(({ start, body }) => ({
      at: `${file}:${text.slice(0, start).split("\n").length}`,
      tokens: body.split(/\s+/).filter(Boolean).map(bare),
    })),
  );
}

/** The `surface-*` classes `index.css` defines, split by scope. */
function definedClasses(): { base: Set<string>; flat: Set<string> } {
  const css = cssWithoutComments(INDEX_CSS);
  const base = new Set<string>();
  const flat = new Set<string>();
  for (const m of css.matchAll(/([^{}]*)\{/g)) {
    for (const selector of m[1].split(",")) {
      const s = selector.trim();
      const isFlat = s.startsWith(FLAT_SCOPE);
      for (const c of s.matchAll(/\.(surface-[a-z]+(?:-[a-z]+)*)/g)) (isFlat ? flat : base).add(c[1]);
    }
  }
  return { base, flat };
}

function usedClasses(): Set<string> {
  return new Set(classTokenSets().flatMap(({ tokens }) => tokens.filter((t) => SURFACE_TOKEN.test(t))));
}

describe("F3.71 the surface vocabulary", () => {
  it("V2 no web source holds a data-surface arbitrary variant", () => {
    const hits = scriptSources()
      .filter(({ text }) => /data-\[surface|\[data-surface/.test(text))
      .map(({ file }) => file);
    expect(hits).toEqual([]);
  });

  it("V3 no class string mixes a surface-* token with the colour utilities it replaces", () => {
    const mixed = classTokenSets()
      .filter(({ tokens }) => tokens.some((t) => SURFACE_TOKEN.test(t)) && tokens.some((t) => REPLACED.test(t)))
      .map(({ at, tokens }) => `${at} ${tokens.filter((t) => SURFACE_TOKEN.test(t) || REPLACED.test(t)).join(" ")}`);
    expect(mixed).toEqual([]);
  });

  it("V4 every surface-* class used in the tree has a neumorphic rule", () => {
    const { base } = definedClasses();
    expect([...usedClasses()].filter((c) => !base.has(c)).sort()).toEqual([]);
  });

  it("V4 every surface-* class used in the tree has a flat rule", () => {
    const { flat } = definedClasses();
    expect([...usedClasses()].filter((c) => !flat.has(c)).sort()).toEqual([]);
  });

  it("V5 every surface-* class index.css defines is used in the tree", () => {
    const { base, flat } = definedClasses();
    const used = usedClasses();
    expect([...new Set([...base, ...flat])].filter((c) => !used.has(c)).sort()).toEqual([]);
  });

  it("V5 the vocabulary is not empty (the scan is live)", () => {
    expect(definedClasses().base.size).toBeGreaterThan(0);
  });

  it("V6 the chrome — the shell's header, nav and footer — carries no surface-* class", () => {
    const text = blankComments(readFileSync(join(repoRoot, APP_SHELL), "utf8"));
    const chrome = [...text.matchAll(/<(header|nav|footer)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .filter((m) => /\bsurface-/.test(m[2] ?? m[3] ?? ""))
      .map((m) => m[1]);
    expect(chrome).toEqual([]);
  });

  it("V6 the chrome scan is live: it finds the shell's header", () => {
    const text = blankComments(readFileSync(join(repoRoot, APP_SHELL), "utf8"));
    expect(/<header\b[^>]*?className=/.test(text)).toBe(true);
  });
});
