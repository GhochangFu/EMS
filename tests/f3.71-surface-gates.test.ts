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

  it("S1b the boot script comes before the module script, so it runs before first paint", () => {
    const tags = [...INDEX_HTML.matchAll(/<script([^>]*)>/g)];
    const plain = tags.findIndex((m) => !/\btype\s*=/.test(m[1]));
    const module = tags.findIndex((m) => /\btype\s*=\s*"module"/.test(m[1]));
    expect(plain !== -1 && module !== -1 && plain < module).toBe(true);
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

type CssRule = { selector: string; flat: boolean; body: string };

/** Every innermost rule of `index.css` whose selector names a `surface-*` class, flat scope stripped. */
function surfaceRules(): CssRule[] {
  const out: CssRule[] = [];
  for (const m of cssWithoutComments(INDEX_CSS).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    for (const raw of m[1].split(",")) {
      const s = raw.trim();
      const flat = s.startsWith(FLAT_SCOPE);
      const selector = flat ? s.slice(FLAT_SCOPE.length).trim() : s;
      if (selector.startsWith(".surface-")) out.push({ selector, flat, body: m[2] });
    }
  }
  return out;
}

/**
 * The `surface-*` classes `index.css` defines, split by scope. A class counts only from a rule on
 * the class itself or its `::after` / `::before` — not from a `:where(:hover)` state rule, so
 * deleting a class's real rule cannot hide behind its hover rule.
 */
function definedClasses(): { base: Set<string>; flat: Set<string> } {
  const base = new Set<string>();
  const flat = new Set<string>();
  for (const { selector, flat: isFlat } of surfaceRules()) {
    const m = /^\.(surface-[a-z]+(?:-[a-z]+)*)(?:::(?:after|before))?$/.exec(selector);
    if (m) (isFlat ? flat : base).add(m[1]);
  }
  return { base, flat };
}

/** The plain declarations of a rule body, by property; `@apply` lines are not declarations. */
function properties(body: string): Set<string> {
  return new Set([...body.matchAll(/(?:^|;|\s)([a-z-]+)\s*:[^;]*;/g)].map((m) => m[1]));
}

/** The utilities a rule body applies. */
function applied(body: string): string[] {
  return [...body.matchAll(/@apply\s+([^;]*);/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean));
}

/**
 * Which applied utility resets a base property. `box-shadow` needs none: its tokens are undefined
 * under Flat, so it computes to `none`. `justify-content`, `align-items`, `gap` and `line-height`
 * ride on `display` and `font-size`.
 */
const RESETS: Record<string, RegExp> = {
  "border-radius": /^rounded(?:-|$)/,
  "background-color": /^bg-/,
  padding: /^p[xytblr]?-/,
  margin: /^m[xytblr]?-/,
  "margin-inline": /^m[xytblr]?-/,
  display: /^(?:block|inline-block|inline|flex|inline-flex|grid|hidden)$/,
  color: /^text-(?!xs$|sm$|base$|lg$|xl$|\[)/,
  "border-width": /^border(?:-[trblxy])?(?:-\d)?$/,
  border: /^border(?:-[trblxy])?(?:-\d)?$/,
  "align-self": /^self-/,
  "min-height": /^min-h-/,
  "font-size": /^text-(?:xs|sm|base|lg|xl|\[)/,
  "font-weight": /^font-(?:normal|medium|semibold|bold)$/,
};
const RIDES_ALONG = new Set(["box-shadow", "justify-content", "align-items", "gap", "line-height"]);

/** Base properties a flat rule deliberately leaves to the base rule, with the reason. Exact. */
const SAME_IN_BOTH: Record<string, Record<string, string>> = {
  ".surface-tab": {
    "font-size": "tabs are text-xs in both styles, as before F3.71",
    "font-weight": "tabs are font-semibold in both styles, as before F3.71",
  },
  ".surface-tab:where(:hover)": { color: "a flat idle tab is already ink; its hover stays ink" },
  ".surface-tab-selected": { "font-weight": "a selected tab is font-semibold in both styles" },
  ".surface-segment-item": {
    "font-size": "segment items are text-xs in both styles, as before F3.71",
    "font-weight": "segment items are font-semibold in both styles, as before F3.71",
  },
  ".surface-segment-item-selected": { "font-weight": "a selected item is font-semibold in both styles" },
  ".surface-dialog": { "border-width": "flat dialogs had no border before F3.71 either" },
  ".surface-pressed-sm": { "border-width": "flat tracks and dials had no border before F3.71 either" },
  ".surface-kpi::after": { content: "the tone bar exists in both styles", top: "the bar sits on the top edge in both styles" },
};

/** `selector property` for every base property its flat twin neither declares nor resets. */
function flatLeaks(rules: CssRule[]): string[] {
  const leaks: string[] = [];
  for (const base of rules.filter((r) => !r.flat)) {
    const flat = rules.find((r) => r.flat && r.selector === base.selector);
    const covered = flat ? properties(flat.body) : new Set<string>();
    const utilities = flat ? applied(flat.body) : [];
    for (const prop of properties(base.body)) {
      if (RIDES_ALONG.has(prop) || covered.has(prop) || SAME_IN_BOTH[base.selector]?.[prop]) continue;
      const reset = RESETS[prop];
      if (reset && utilities.some((u) => reset.test(u))) continue;
      leaks.push(`${base.selector} ${prop}`);
    }
  }
  return leaks.sort();
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

  it("V7 every flat rule resets each property its neumorphic rule sets (Flat looks like before F3.71)", () => {
    expect(flatLeaks(surfaceRules())).toEqual([]);
  });

  it("V7 every SAME_IN_BOTH entry names a property its base rule still sets (the list cannot go stale)", () => {
    const rules = surfaceRules();
    const stale = Object.entries(SAME_IN_BOTH).flatMap(([selector, props]) =>
      Object.keys(props)
        .filter((prop) => !rules.some((r) => !r.flat && r.selector === selector && properties(r.body).has(prop)))
        .map((prop) => `${selector} ${prop}`),
    );
    expect(stale).toEqual([]);
  });

  it("V8 every surface-* state rule is :where(:state), so a call-site tone utility still wins", () => {
    const bare = surfaceRules()
      .filter(({ selector }) => /(?<!:where\():(?:hover|active|focus(?:-visible|-within)?)\b/.test(selector))
      .map(({ selector, flat }) => `${flat ? "flat " : ""}${selector}`);
    expect(bare).toEqual([]);
  });

  it("V7 the scan is live: an empty flat rule leaks its base rule's radius", () => {
    const rules: CssRule[] = [
      { selector: ".surface-x", flat: false, body: " border-radius: 14px; box-shadow: var(--shadow-pressed); " },
      { selector: ".surface-x", flat: true, body: " " },
    ];
    expect(flatLeaks(rules)).toEqual([".surface-x border-radius"]);
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
