import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";
import { blendOver, contrastRatio, parseTokenBlocks, type Channels, channelsToHex } from "./support/colour-tokens";

/**
 * `F3.65a` — every declared colour pair in `docs/plans/f3.65a-colour-tokens.md` §2.4 holds its
 * threshold in both themes: `TEXT_PAIRS` at 4.5:1 (WCAG 1.4.3), `UI_PAIRS` at 3:1 (WCAG 1.4.11),
 * read against the real `apps/web/src/index.css` roles through `tests/support/colour-tokens.ts`.
 *
 * A pair with `alpha` blends `fg` at that opacity over its background before measuring (the
 * `text-on-dark/70` shapes in `layouts/app-shell.tsx`). A pair with `wash` blends a role's own
 * tint over its `bg` before measuring `fg` against that tint (the OK-pill background, `accent/10`
 * over `surface`).
 *
 * **`critical-ink-soft` (`text-red-600`) is declared on `surface` only.** The tree carries 29
 * `text-red-600` uses (one of them `hover:`), mostly error and alert `<p>` lines; none carries a
 * red wash on its own element. Their ancestors were not checked site by site, so a use inside a
 * `bg-red-50` / `bg-red-100` wash, or straight on the page canvas (4.38 light, under 4.5), is
 * not excluded: `F3.65b` declares that pair when its migration meets one. §2.4's wash ratios for
 * this role are "for the record", not declared.
 *
 * **`ink-faint` on `canvas` (4.32 light) is deliberately absent** — its 12 uses sit inside cards,
 * never directly on the page canvas (§2.4). `line` / `line-strong` on `surface`, and each
 * `*-line` role on its own wash, are decorative boundaries under WCAG 1.4.11's exemption (a
 * boundary that is not the sole indicator of a state) and are not declared either (OQ5).
 *
 * `F3.65b` (plan §2.5) adds three pairs the migration creates: `neutral-ink` on `canvas` (the
 * `bg-slate-100 text-slate-700` org-code chips), `ink-muted` on `line` (the `bg-gray-200
 * text-gray-600` pills), and `on-dark` at 0.4 on `chrome` (the footer loading dot).
 *
 * Two pairs the same migration produces are declared not to hold, for a reason rather than an
 * allowlist entry: `ink-faint` on `line` in the SMOC schematics' offline boxes
 * (`smoc/sld.tsx:285/326/328` sub-labels on `fill-gray-200`, 3.84 | 3.64) — today `gray-500` on
 * `gray-200` is already 3.50, an existing failure in an 8 px SVG label that `F3.65c` recolours
 * with the rest of the schematic; and `critical-ink-soft` on `canvas` (4.38 light) — no
 * `text-red-600` shares a string with a red wash (grep: 0), so F3.65a's stance holds. **The dark
 * allowlist stays empty.**
 */

const TOKENS_PATH = join(repoRoot, "apps/web/src/index.css");

function loadTokens() {
  return parseTokenBlocks(readFileSync(TOKENS_PATH, "utf8"));
}

type Theme = "light" | "dark";
type Pair = { fg: string; bg: string; alpha?: number; wash?: { tint: string; alpha: number } };
type AllowlistEntry = Pair & { theme: Theme; measured: number; reason: string; threshold: 4.5 | 3 };

function hexOf(role: string, theme: Theme, tokens: ReturnType<typeof loadTokens>): string {
  const map = theme === "light" ? tokens.light : tokens.dark;
  const channels = map.get(role);
  if (!channels) throw new Error(`no token for role "${role}" (${theme})`);
  return channelsToHex(channels as Channels);
}

/** The contrast ratio of `pair` in `theme`, applying `wash` (background tint) and `alpha`
 * (foreground opacity) exactly as the rendered class would composite them. */
function ratioOf(pair: Pair, theme: Theme, tokens: ReturnType<typeof loadTokens>): number {
  let bg = hexOf(pair.bg, theme, tokens);
  if (pair.wash) bg = blendOver(hexOf(pair.wash.tint, theme, tokens), bg, pair.wash.alpha);
  let fg = hexOf(pair.fg, theme, tokens);
  if (pair.alpha != null) fg = blendOver(fg, bg, pair.alpha);
  return contrastRatio(fg, bg);
}

/**
 * Text pairs, 4.5:1 (WCAG 1.4.3) — `docs/plans/f3.65a-colour-tokens.md` §2.4 "Declared text
 * pairs" table, transcribed row by role-on-role, one entry per `/`-separated background.
 */
const TEXT_PAIRS: Pair[] = [
  { fg: "ink", bg: "surface" },
  { fg: "ink", bg: "canvas" },
  { fg: "ink", bg: "well" },
  { fg: "ink", bg: "well-deep" },
  { fg: "ink-muted", bg: "surface" },
  { fg: "ink-muted", bg: "canvas" },
  { fg: "ink-muted", bg: "well" },
  { fg: "ink-muted", bg: "well-deep" },
  { fg: "ink-faint", bg: "surface" },
  { fg: "ink-faint", bg: "well" },
  // F3.65b §2.5: the `bg-gray-200 text-gray-600` pills (`breaker-table.tsx`, `smoc/overview.tsx`) → `bg-line text-ink-muted`.
  { fg: "ink-muted", bg: "line" },
  { fg: "neutral-ink", bg: "well-deep" },
  { fg: "neutral-ink", bg: "well" },
  { fg: "neutral-ink", bg: "surface" },
  // F3.65b §2.5: the org-code chips (`bg-slate-100 text-slate-700` → `bg-canvas text-neutral-ink`).
  { fg: "neutral-ink", bg: "canvas" },
  { fg: "accent", bg: "surface" },
  { fg: "accent", bg: "canvas" },
  { fg: "accent", bg: "well" },
  { fg: "accent", bg: "surface", wash: { tint: "accent", alpha: 0.1 } },
  // The app-shell wordmark and footer label (`text-accent` in `bg-chrome`): 4.88 light, 8.71 dark.
  { fg: "accent", bg: "chrome" },
  { fg: "accent-strong", bg: "surface" },
  { fg: "critical-ink-soft", bg: "surface" },
  { fg: "critical-ink", bg: "surface" },
  { fg: "critical-ink", bg: "critical-wash" },
  { fg: "critical-ink", bg: "critical-wash-strong" },
  { fg: "critical-ink-strong", bg: "surface" },
  { fg: "critical-ink-strong", bg: "critical-wash" },
  { fg: "critical-ink-strong", bg: "critical-wash-strong" },
  { fg: "warning-ink", bg: "surface" },
  { fg: "warning-ink", bg: "warning-wash" },
  { fg: "warning-ink", bg: "warning-wash-strong" },
  { fg: "ok-ink", bg: "surface" },
  { fg: "ok-ink", bg: "ok-wash" },
  { fg: "info-ink", bg: "surface" },
  { fg: "info-ink", bg: "info-wash" },
  { fg: "on-dark", bg: "chrome" },
  { fg: "on-dark", bg: "chrome-nav" },
  { fg: "on-dark", bg: "critical" },
  { fg: "on-dark", bg: "chrome", alpha: 0.7 },
  { fg: "on-dark", bg: "chrome", alpha: 0.6 },
  { fg: "on-accent", bg: "accent" },
  { fg: "on-accent", bg: "accent-strong" },
  { fg: "critical-on-dark", bg: "chrome" },
  { fg: "warning-on-dark", bg: "chrome" },
  // ADR 0078 Amendment 1 §1 (owner ruling 2026-09-28): the 41st role, `simulated-ink` — light is Tailwind
  // violet-700 exact (7.10 / 6.80); dark is D3-derived, forced past the first sheet/paper-only
  // stopping point (4.51 / 4.87, failing `well` at 4.04) to also clear `well` (5.13 / 5.54 / 4.59).
  { fg: "simulated-ink", bg: "surface" },
  { fg: "simulated-ink", bg: "well" },
];

/**
 * UI-part pairs, 3:1 (WCAG 1.4.11) — §2.4 "Declared UI-part pairs" table, plus the one text-table
 * row explicitly marked "a 3:1 pair" (`on-dark` at 0.7 on `chrome-nav`, F4.164 S14).
 */
const UI_PAIRS: Pair[] = [
  { fg: "accent", bg: "surface" },
  { fg: "focus", bg: "surface" },
  { fg: "accent", bg: "canvas" },
  { fg: "focus", bg: "canvas" },
  { fg: "on-dark", bg: "chrome-nav", alpha: 0.8 },
  { fg: "on-dark", bg: "chrome-nav", alpha: 0.7 },
  // F3.65b §2.5: the footer loading dot (`bg-white/40` → `bg-on-dark/40`) on the chrome footer.
  { fg: "on-dark", bg: "chrome", alpha: 0.4 },
  { fg: "critical", bg: "surface" },
  { fg: "critical", bg: "canvas" },
  { fg: "critical", bg: "chrome" },
  { fg: "warning", bg: "surface" },
  { fg: "warning", bg: "canvas" },
  { fg: "info", bg: "surface" },
  { fg: "info", bg: "canvas" },
  { fg: "ink-hint", bg: "surface" },
];

/**
 * The light allowlist, exact — §2.4 "Light allowlist (exact, with reason)". Dark allowlist is
 * empty: every declared pair clears its threshold in dark with the values §2.2 sets.
 */
const ALLOWLIST: AllowlistEntry[] = [
  {
    fg: "accent",
    bg: "surface",
    theme: "light",
    measured: 3.19,
    threshold: 4.5,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "accent",
    bg: "canvas",
    theme: "light",
    measured: 2.9,
    threshold: 4.5,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "accent",
    bg: "well",
    theme: "light",
    measured: 3.06,
    threshold: 4.5,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "accent",
    bg: "surface",
    wash: { tint: "accent", alpha: 0.1 },
    theme: "light",
    measured: 2.86,
    threshold: 4.5,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "on-accent",
    bg: "accent",
    theme: "light",
    measured: 3.19,
    threshold: 4.5,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "accent",
    bg: "canvas",
    theme: "light",
    measured: 2.9,
    threshold: 3,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "focus",
    bg: "canvas",
    theme: "light",
    measured: 2.9,
    threshold: 3,
    reason: "the brand green as text or under white text; ADR 0078 decision 2 keeps the light theme",
  },
  {
    fg: "warning",
    bg: "surface",
    theme: "light",
    measured: 2.15,
    threshold: 3,
    reason: "status dots and bars are duplicated by text; existing",
  },
  {
    fg: "warning",
    bg: "canvas",
    theme: "light",
    measured: 1.95,
    threshold: 3,
    reason: "status dots and bars are duplicated by text; existing",
  },
  {
    fg: "info",
    bg: "surface",
    theme: "light",
    measured: 2.77,
    threshold: 3,
    reason: "status dots and bars are duplicated by text; existing",
  },
  {
    fg: "info",
    bg: "canvas",
    theme: "light",
    measured: 2.52,
    threshold: 3,
    reason: "status dots and bars are duplicated by text; existing",
  },
  {
    fg: "ink-hint",
    bg: "surface",
    theme: "light",
    measured: 2.54,
    threshold: 3,
    reason: "placeholder / inactive; WCAG 1.4.3 inactive exception",
  },
];

function samePair(a: Pair, b: Pair): boolean {
  const washEq = (a.wash?.tint ?? null) === (b.wash?.tint ?? null) && (a.wash?.alpha ?? null) === (b.wash?.alpha ?? null);
  return a.fg === b.fg && a.bg === b.bg && (a.alpha ?? null) === (b.alpha ?? null) && washEq;
}

/** The entry for `pair` in `theme` at `threshold` — a 4.5:1 text entry never exempts the 3:1 UI pair. */
function allowlistEntryFor(pair: Pair, theme: Theme, threshold: number): AllowlistEntry | undefined {
  return ALLOWLIST.find((e) => e.theme === theme && e.threshold === threshold && samePair(e, pair));
}

function checkPairs(pairs: Pair[], threshold: number, theme: Theme, tokens: ReturnType<typeof loadTokens>) {
  const offenders: string[] = [];
  for (const pair of pairs) {
    if (allowlistEntryFor(pair, theme, threshold)) continue;
    const ratio = ratioOf(pair, theme, tokens);
    if (ratio < threshold) {
      offenders.push(`${pair.fg} on ${pair.bg}${pair.alpha != null ? `/${pair.alpha}` : ""} (${theme}): ${ratio.toFixed(2)} < ${threshold}`);
    }
  }
  return offenders;
}

describe("F3.65a: every declared colour pair holds its contrast threshold in both themes", () => {
  const tokens = loadTokens();

  it("C1 every text pair is at least 4.5:1 in light, unless allowlisted", () => {
    expect(checkPairs(TEXT_PAIRS, 4.5, "light", tokens)).toEqual([]);
  });

  it("C2 every text pair is at least 4.5:1 in dark, unless allowlisted", () => {
    expect(checkPairs(TEXT_PAIRS, 4.5, "dark", tokens)).toEqual([]);
  });

  it("C3 every UI-part pair is at least 3:1 in light, unless allowlisted", () => {
    expect(checkPairs(UI_PAIRS, 3, "light", tokens)).toEqual([]);
  });

  it("C4 every UI-part pair is at least 3:1 in dark, unless allowlisted", () => {
    expect(checkPairs(UI_PAIRS, 3, "dark", tokens)).toEqual([]);
  });

  it("C5 every allowlist entry's pair really fails its own threshold (the allowlist is tight)", () => {
    const notFailing = ALLOWLIST.filter((e) => ratioOf(e, e.theme, tokens) >= e.threshold);
    expect(notFailing, JSON.stringify(notFailing)).toEqual([]);
  });

  it("C6 every allowlist entry's measured value equals the computed ratio to 2 dp", () => {
    const drifted = ALLOWLIST.map((e) => [e, Number(ratioOf(e, e.theme, tokens).toFixed(2))] as const)
      .filter(([e, computed]) => computed !== e.measured)
      .map(([e, computed]) => `${e.fg} on ${e.bg} (${e.theme}, ${e.threshold}): recorded ${e.measured}, computed ${computed}`);
    expect(drifted).toEqual([]);
  });

  it("C8 an allowlist entry exempts a pair only at the entry's own threshold", () => {
    const crossed: string[] = [];
    for (const [pairs, threshold] of [[TEXT_PAIRS, 4.5], [UI_PAIRS, 3]] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const pair of pairs) {
          const entry = allowlistEntryFor(pair, theme, threshold);
          if (entry && entry.threshold !== threshold) {
            crossed.push(`${pair.fg} on ${pair.bg} (${theme}, ${threshold}) exempted by the ${entry.threshold} entry`);
          }
        }
      }
    }
    expect(crossed).toEqual([]);
  });

  it("C7 every pair (TEXT_PAIRS, UI_PAIRS, ALLOWLIST) references only roles the token file defines", () => {
    const roles = new Set(tokens.light.keys());
    const names = new Set<string>();
    for (const p of [...TEXT_PAIRS, ...UI_PAIRS, ...ALLOWLIST]) {
      names.add(p.fg);
      names.add(p.bg);
      if (p.wash) names.add(p.wash.tint);
    }
    const unknown = [...names].filter((n) => !roles.has(n));
    expect(unknown).toEqual([]);
  });
});
