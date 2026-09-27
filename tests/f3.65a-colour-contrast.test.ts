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
 * **`critical-ink-soft` (`text-red-600`) is declared on `surface` only.** The tree carries 24
 * `text-red-600` sites; every one of them sits directly on a plain surface (a `<p>` inside a
 * white card or list row) — none sits inside a `bg-red-50` / `bg-red-100` wash. §2.4's note is
 * therefore read literally: the wash rows for this role are "for the record", not declared.
 *
 * **`ink-faint` on `canvas` (4.32 light) is deliberately absent** — its 12 uses sit inside cards,
 * never directly on the page canvas (§2.4). `line` / `line-strong` on `surface`, and each
 * `*-line` role on its own wash, are decorative boundaries under WCAG 1.4.11's exemption (a
 * boundary that is not the sole indicator of a state) and are not declared either (OQ5).
 *
 * **Known plan/measurement disagreement, reported rather than silently changed:** §2.4 prints
 * `critical` on `chrome` as **3.23 in both themes**. Measured here against the real dark `chrome`
 * (`#0F1620`, darker than light `chrome`), the ratio is **3.76**, not 3.23 — `critical` is
 * unchanged between themes while `chrome` gets darker, so the dark ratio should be *higher* than
 * light's 3.23, matching the pattern of the `surface` and `canvas` columns of the same row (which
 * both rise from light to dark). This does not change any assertion below: 3.76 clears 3:1 as
 * easily as 3.23 does, so the pair needs no allowlist entry either way — flagged for the plan
 * gate, not worked around here.
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
  { fg: "neutral-ink", bg: "well-deep" },
  { fg: "neutral-ink", bg: "well" },
  { fg: "neutral-ink", bg: "surface" },
  { fg: "accent", bg: "surface" },
  { fg: "accent", bg: "canvas" },
  { fg: "accent", bg: "well" },
  { fg: "accent", bg: "surface", wash: { tint: "accent", alpha: 0.1 } },
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

function allowlistEntryFor(pair: Pair, theme: Theme): AllowlistEntry | undefined {
  return ALLOWLIST.find((e) => e.theme === theme && samePair(e, pair));
}

function checkPairs(pairs: Pair[], threshold: number, theme: Theme, tokens: ReturnType<typeof loadTokens>) {
  const offenders: string[] = [];
  for (const pair of pairs) {
    if (allowlistEntryFor(pair, theme)) continue;
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
    for (const entry of ALLOWLIST) {
      expect(Number(ratioOf(entry, entry.theme, tokens).toFixed(2)), `${entry.fg} on ${entry.bg}`).toBeCloseTo(
        entry.measured,
        2,
      );
    }
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
