import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { repoRoot } from "./support/source-scan";
import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { FIXED_ROLES, PROFILE_ROLES } from "../apps/web/src/lib/theme";
import {
  blendOver,
  channelsToHex,
  contrastRatio,
  deltaE2000,
  parseProfileBlocks,
  parseTokenBlocks,
  profileTokens,
  type Channels,
} from "./support/colour-tokens";

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
 * **`ink-faint` on `canvas` is a text pair since `F4.341` (T-ink, ADR 0118 Amendment 2 P6):** the
 * light `ink-faint` of every profile was raised until it passes 4.5:1 on its canvas, because every
 * `nexus-soft` card paints `canvas`. The history: it was deliberately absent as a text pair — its 12 uses sat
 * inside cards; `F3.71` (plan OQ2) moves them to `ink-muted` because its neumorphic cards paint
 * `canvas`, and declares `ink-faint` on `canvas` as a UI pair only (the form field's edge). Before
 * `F3.71` its 12 uses sat inside cards,
 * never directly on the page canvas (§2.4). `line` / `line-strong` on `surface`, and each
 * `*-line` role on its own wash, are decorative boundaries under WCAG 1.4.11's exemption (a
 * boundary that is not the sole indicator of a state) and are not declared either (OQ5).
 *
 * `F3.65b` (plan §2.5) adds three pairs the migration creates: `neutral-ink` on `canvas` (the
 * `bg-slate-100 text-slate-700` org-code chips), `ink-muted` on `line` (the `bg-gray-200
 * text-gray-600` pills), and `on-dark` at 0.4 on `chrome` (the footer loading dot). Its review
 * adds two UI pairs for the rules-panel toggle knob — `on-accent` on `accent` and `on-dark` on
 * `line-strong` — and one light allowlist entry for the second (1.47, the existing white knob on
 * the gray track).
 *
 * Two pairs the same migration produces are declared not to hold, for a reason rather than an
 * allowlist entry: `ink-faint` on `line` in the SMOC schematics' offline boxes
 * (`smoc/sld.tsx:285/326/328` sub-labels on `fill-gray-200`, 3.84 | 3.64) — today `gray-500` on
 * `gray-200` is already 3.50, an existing failure in an 8 px SVG label that `F3.65c` recolours
 * with the rest of the schematic; and `critical-ink-soft` on `canvas` (4.38 light) — no
 * `text-red-600` shares a string with a red wash (grep: 0), so F3.65a's stance holds. **The dark
 * allowlist stayed empty until the owner ruling of 2026-09-29**, which added two entries for the
 * formula editor's selected state (see `ALLOWLIST`).
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
  // F4.341 T-ink (ADR 0118 Amendment 2 P6): meta text on a neumorphic card, which paints `canvas`.
  { fg: "ink-faint", bg: "canvas" },
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
  // The app-shell wordmark and footer label (`text-accent` in `bg-chrome` until F4.310): 4.88 light, 8.71 dark.
  // F4.310 PR A (ADR 0110, plan OQ2): the wordmark "NEXUS" and the shell footer label move to
  // `accent-on-chrome`; the footer's "good" system status is the fixed `ok` on chrome.
  { fg: "accent-on-chrome", bg: "chrome" },
  { fg: "ok", bg: "chrome" },
  // F4.310 PR A: the OK pill (`border-ok/20 bg-ok/10 text-ok-strong`) on a flat card, and the brand
  // pill that keeps `accent` (`bg-accent/10 text-accent-strong`). The same OK pill straight on
  // `canvas` is 4.34 light — an existing pixel (`accent-strong` on `accent/10`), never declared;
  // raised in the F4.310 PR A body, not declared here.
  { fg: "ok-strong", bg: "surface", wash: { tint: "ok", alpha: 0.1 } },
  { fg: "accent-strong", bg: "surface", wash: { tint: "accent", alpha: 0.1 } },
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
  // F3.65c U4 — green text on the ok tint (D7): crac-schematic.tsx's chiller "Load … kW" label,
  // electrical-sld's UPS labels (already `#007C3C`, U5).
  // F4.310 PR A: the CRAC/SLD status labels on `ok-wash` read `ok-strong` (was `accent-strong`).
  { fg: "ok-strong", bg: "ok-wash" },
  // F3.65c U4 — crac-schematic.tsx labels beside a `fill-well` panel (the fan hub, the compressor
  // bank frame).
  { fg: "info-ink", bg: "well" },
  // F3.65c U6 — the six SMOC views' status pills, tiles and matched-rule notes sit on a `well`
  // sensor-table header or the SMOC boards' offline `well` panels.
  { fg: "warning-ink", bg: "well" },
  { fg: "critical-ink-strong", bg: "well" },
  // F3.65c U10 — the header's Light / Dark switch (`components/theme-switch.tsx`) on `chrome`: the
  // idle label at 0.85 (also the Logout button's `text-on-dark/85`, undeclared until now), the idle
  // label under its `hover:bg-on-dark/10` wash, and the pressed label on its `bg-on-dark/15` wash.
  { fg: "on-dark", bg: "chrome", alpha: 0.85 },
  { fg: "on-dark", bg: "chrome", alpha: 0.85, wash: { tint: "on-dark", alpha: 0.1 } },
  { fg: "on-dark", bg: "chrome", wash: { tint: "on-dark", alpha: 0.15 } },
  // F3.65c review, owner ruling 2026-09-29 — the formula editor's selection
  // (`formula-editor.tsx` `CALC_THEME_SPEC`), focused or not, is `info` at 0.15 on the `surface`
  // editor. The text over it is every token ink the editor paints. Dark `simulated-ink` and
  // `info-ink` fall under 4.5 there and are allowlisted below.
  { fg: "ink", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  { fg: "ink-muted", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  { fg: "accent-strong", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  { fg: "simulated-ink", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  { fg: "warning-ink", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  { fg: "info-ink", bg: "surface", wash: { tint: "info", alpha: 0.15 } },
  // F3.71 (ADR 0085 decision 3, plan OQ2) — a neumorphic card paints `canvas`, not `surface`: the
  // selected tab, sidebar link and button labels (`accent-strong`), the OK pill's `ok-ink` on its
  // `accent`/0.1 wash over `canvas` (owner ruling 2026-09-29: `accent-strong` there is 4.34
  // light), and the inks the sweeps move there — `critical-ink` for the retired
  // `critical-ink-soft` text, the status inks of the cards' notes.
  { fg: "accent-strong", bg: "canvas" },
  { fg: "ok-ink", bg: "canvas", wash: { tint: "ok", alpha: 0.1 } },
  { fg: "critical-ink", bg: "canvas" },
  { fg: "warning-ink", bg: "canvas" },
  { fg: "info-ink", bg: "canvas" },
  { fg: "ok-ink", bg: "canvas" },
];

/**
 * UI-part pairs, 3:1 (WCAG 1.4.11) — §2.4 "Declared UI-part pairs" table, plus the one text-table
 * row explicitly marked "a 3:1 pair" (`on-dark` at 0.7 on `chrome-nav`, F4.164 S14).
 */
const UI_PAIRS: Pair[] = [
  { fg: "accent", bg: "surface" },
  { fg: "focus", bg: "surface" },
  // F4.310 PR A: the OK / normal / energised strokes and fills of the schematics, the map and the
  // health donut move from `accent` to the fixed `ok` / `ok-strong`.
  { fg: "ok", bg: "surface" },
  { fg: "ok", bg: "canvas" },
  { fg: "ok-strong", bg: "surface" },
  { fg: "accent", bg: "canvas" },
  { fg: "focus", bg: "canvas" },
  { fg: "on-dark", bg: "chrome-nav", alpha: 0.8 },
  { fg: "on-dark", bg: "chrome-nav", alpha: 0.7 },
  // F3.65b §2.5: the footer loading dot (`bg-white/40` → `bg-on-dark/40`) on the chrome footer.
  { fg: "on-dark", bg: "chrome", alpha: 0.4 },
  // F3.65b review: the rules-panel enable toggle's knob on its track (`rules-panel.tsx:407`) —
  // `on-accent` on the enabled `accent` track (3.19 light / 8.71 dark), `on-dark` on the disabled
  // `line-strong` track (9.02 dark; 1.47 light, allowlisted below).
  { fg: "on-accent", bg: "accent" },
  { fg: "on-dark", bg: "line-strong" },
  { fg: "critical", bg: "surface" },
  { fg: "critical", bg: "canvas" },
  { fg: "critical", bg: "chrome" },
  { fg: "warning", bg: "surface" },
  { fg: "warning", bg: "canvas" },
  { fg: "info", bg: "surface" },
  { fg: "info", bg: "canvas" },
  { fg: "ink-hint", bg: "surface" },
  // F3.65c OQ4: the health donut's Fair slice (`health-summary-donut.tsx`) on its `surface` card.
  { fg: "warning-on-dark", bg: "surface" },
  // F3.65c U10 — the theme switch's focus ring (`focus-visible:ring-on-dark/80`, inset: the group's
  // `overflow-hidden` clips an outer ring) on an idle button's bare `chrome`, and on the pressed
  // button's `on-dark/15` wash — a keyboard press leaves the focused button pressed.
  { fg: "on-dark", bg: "chrome", alpha: 0.8 },
  { fg: "on-dark", bg: "chrome", alpha: 0.8, wash: { tint: "on-dark", alpha: 0.15 } },
  // F3.71 (ADR 0085 decision 4) — a neumorphic form field's 1px `ink-faint` edge on `canvas`: the
  // control's boundary, so WCAG 1.4.11 applies (4.32 light, 5.46 dark).
  { fg: "ink-faint", bg: "canvas" },
  // ADR 0078 Amendment 4 (F4.306) — the trend strip's per-point series colours are a graphic line
  // on the `surface` card (WCAG 1.4.11). The measured ratios are recorded in the amendment.
  { fg: "series-1", bg: "surface" },
  { fg: "series-2", bg: "surface" },
  { fg: "series-3", bg: "surface" },
  { fg: "series-4", bg: "surface" },
  { fg: "series-5", bg: "surface" },
  { fg: "series-6", bg: "surface" },
  { fg: "series-7", bg: "surface" },
  { fg: "series-8", bg: "surface" },
];

/**
 * The light allowlist, exact — §2.4 "Light allowlist (exact, with reason)". The dark allowlist
 * was empty until the owner ruling of 2026-09-29: its two entries are the formula editor's token
 * inks `simulated-ink` and `info-ink` over the `info`/0.15 selection, a transient selected state.
 * Every other declared pair clears its threshold in dark with the values §2.2 sets.
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
    // F4.310 PR A: the same pixel as `accent` on `canvas` above, now through the fixed `ok` role
    // (the health donut's good slice and the schematic strokes on a neumorphic card).
    fg: "ok",
    bg: "canvas",
    theme: "light",
    measured: 2.9,
    threshold: 3,
    reason: "the OK state in today's brand green, existing pixel; the state is also named in text",
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
  {
    // F3.65c OQ4 — the health donut's Fair slice.
    fg: "warning-on-dark",
    bg: "surface",
    theme: "light",
    measured: 1.67,
    threshold: 3,
    reason: "status slices are named in the legend list; existing",
  },
  {
    fg: "on-dark",
    bg: "line-strong",
    theme: "light",
    measured: 1.47,
    threshold: 3,
    reason: "the disabled rule toggle's white knob on its gray track; existing pixel — the knob's position and the button's label carry the state",
  },
  {
    // F3.65c owner ruling 2026-09-29 — a DARK entry, the first: the formula editor's selection.
    fg: "simulated-ink",
    bg: "surface",
    wash: { tint: "info", alpha: 0.15 },
    theme: "dark",
    measured: 4.04,
    threshold: 4.5,
    reason: "transient selected state; unselected text keeps 4.5",
  },
  {
    // F3.65c owner ruling 2026-09-29 — a DARK entry, the first: the formula editor's selection.
    fg: "info-ink",
    bg: "surface",
    wash: { tint: "info", alpha: 0.15 },
    theme: "dark",
    measured: 3.98,
    threshold: 4.5,
    reason: "transient selected state; unselected text keeps 4.5",
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

function checkPairs(
  pairs: Pair[],
  threshold: number,
  theme: Theme,
  tokens: ReturnType<typeof loadTokens>,
  allowed: (pair: Pair, theme: Theme, threshold: number) => boolean = (p, t, th) => allowlistEntryFor(p, t, th) !== undefined,
) {
  const offenders: string[] = [];
  for (const pair of pairs) {
    if (allowed(pair, theme, threshold)) continue;
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

/**
 * ADR 0078 Amendment 4 item 2 (F4.306) — the eight `series-*` roles. A series line must not read
 * as an alarm, so each role sits far from `warning` and `critical` in its own theme (CIEDE2000,
 * the distance the mapping table uses), and the eight are told apart from one another. The
 * thresholds are the plan's (`docs/plans/f4.306-trend-strip-wizard.md` PR 2 §7 D2): 20 from an
 * alarm colour (measured minimum 35.73, dark `series-7` vs `warning`) and 10 between two series
 * (measured minima 11.73 light, 10.66 dark). The 3:1 rule on `surface` is C3/C4 above.
 *
 * The role list is read from the token file, not typed here, and S3 holds it to exactly
 * `series-1` … `series-8` — so S1/S2 cannot skip a role the file defines.
 */
const SERIES_EXPECTED = ["series-1", "series-2", "series-3", "series-4", "series-5", "series-6", "series-7", "series-8"];
const ALARM_ROLES = ["warning", "critical"] as const;
const MIN_ALARM_DELTA_E = 20;
const MIN_SERIES_DELTA_E = 10;

function seriesRolesOf(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  const map = theme === "light" ? tokens.light : tokens.dark;
  return [...map.keys()].filter((role) => role.startsWith("series-"));
}

function alarmOffenders(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  const out: string[] = [];
  for (const role of seriesRolesOf(theme, tokens)) {
    for (const alarm of ALARM_ROLES) {
      const d = deltaE2000(hexOf(role, theme, tokens), hexOf(alarm, theme, tokens));
      if (!(d >= MIN_ALARM_DELTA_E)) out.push(`${role} vs ${alarm} (${theme}): ΔE2000 ${d.toFixed(2)} < ${MIN_ALARM_DELTA_E}`);
    }
  }
  return out;
}

function pairOffenders(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  const roles = seriesRolesOf(theme, tokens);
  const out: string[] = [];
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      const d = deltaE2000(hexOf(roles[i], theme, tokens), hexOf(roles[j], theme, tokens));
      if (!(d >= MIN_SERIES_DELTA_E)) out.push(`${roles[i]} vs ${roles[j]} (${theme}): ΔE2000 ${d.toFixed(2)} < ${MIN_SERIES_DELTA_E}`);
    }
  }
  return out;
}

describe("F4.306 series roles (ADR 0078 Amendment 4): far from the alarm colours, apart from each other", () => {
  const tokens = loadTokens();

  it("S1 every series role is at least ΔE2000 20 from warning and critical in light", () => {
    expect(alarmOffenders("light", tokens)).toEqual([]);
  });

  it("S1 every series role is at least ΔE2000 20 from warning and critical in dark", () => {
    expect(alarmOffenders("dark", tokens)).toEqual([]);
  });

  it("S2 every pair of series roles is at least ΔE2000 10 apart in light", () => {
    expect(pairOffenders("light", tokens)).toEqual([]);
  });

  it("S2 every pair of series roles is at least ΔE2000 10 apart in dark", () => {
    expect(pairOffenders("dark", tokens)).toEqual([]);
  });

  it("S3 the light block's series roles are exactly series-1 … series-8", () => {
    expect(seriesRolesOf("light", tokens).sort()).toEqual(SERIES_EXPECTED);
  });

  it("S3 the dark block's series roles are exactly series-1 … series-8", () => {
    expect(seriesRolesOf("dark", tokens).sort()).toEqual(SERIES_EXPECTED);
  });
});

/**
 * `F4.310` PR C (ADR 0110 decision 5, plan OQ1 and OQ3) — every colour profile in `index.css`
 * holds the same rules as the default, on its own values (`profileTokens`: the base blocks with the
 * profile's lines laid over them). A profile has **no allowlist of its own**: it may keep failing
 * only a `CARRY_OVER` pair, the default's entries whose cause is a fixed role or a WCAG exemption
 * (OQ1, plus `ok` on `canvas` from PR A). The seven brand-green entries never carry over.
 *
 * The default (`nexus`) keeps its full allowlist under C1–C4, so Q1/Q2 skip it; Q3/Q4 hold for every
 * profile, the default included. Until PR D adds profile blocks, Q1/Q2 check nothing — the parser
 * tests in `tests/f4.310-profile-blocks.test.ts` and Q0 (the carry-over list stays inside the
 * default's allowlist) are what this PR proves.
 */
type CarryEntry = Pair & { theme: Theme; threshold: 4.5 | 3 };
const CARRY_OVER: CarryEntry[] = [
  { fg: "warning", bg: "surface", theme: "light", threshold: 3 },
  { fg: "warning", bg: "canvas", theme: "light", threshold: 3 },
  { fg: "info", bg: "surface", theme: "light", threshold: 3 },
  { fg: "info", bg: "canvas", theme: "light", threshold: 3 },
  { fg: "warning-on-dark", bg: "surface", theme: "light", threshold: 3 },
  { fg: "ok", bg: "canvas", theme: "light", threshold: 3 },
  { fg: "ink-hint", bg: "surface", theme: "light", threshold: 3 },
  { fg: "on-dark", bg: "line-strong", theme: "light", threshold: 3 },
  { fg: "simulated-ink", bg: "surface", wash: { tint: "info", alpha: 0.15 }, theme: "dark", threshold: 4.5 },
  { fg: "info-ink", bg: "surface", wash: { tint: "info", alpha: 0.15 }, theme: "dark", threshold: 4.5 },
];
const MIN_ACCENT_STATE_DELTA_E = 12;

function carried(pair: Pair, theme: Theme, threshold: number): boolean {
  return CARRY_OVER.some((e) => e.theme === theme && e.threshold === threshold && samePair(e, pair));
}

/** Every profile's resolved tokens, the default first. */
function profilesOf(): Array<[string, ReturnType<typeof loadTokens>]> {
  const css = readFileSync(TOKENS_PATH, "utf8");
  const base = parseTokenBlocks(css);
  const blocks = parseProfileBlocks(css, {
    names: COLOUR_PROFILES,
    defaultName: "nexus",
    profileRoles: PROFILE_ROLES,
    fixedRoles: FIXED_ROLES,
  });
  return [["nexus", base], ...[...blocks].map(([name, b]) => [name, profileTokens(base, b)] as [string, ReturnType<typeof loadTokens>])];
}

function everyProfile(check: (name: string, theme: Theme, tokens: ReturnType<typeof loadTokens>) => string[]): string[] {
  const out: string[] = [];
  for (const [name, tokens] of profilesOf()) {
    for (const theme of ["light", "dark"] as const) out.push(...check(name, theme, tokens).map((o) => `${name}: ${o}`));
  }
  return out;
}

/**
 * `F4.341` A4 (ADR 0118 Amendment 1 A4, superseding Q4's narrower OQ3 check): the whole accent
 * family against **every** alarm role and every info role, in both themes, for every profile.
 * The role lists are read from the token file by prefix, so a new `critical-*` role is covered.
 */
const ACCENT_FAMILY = ["accent", "accent-strong", "accent-on-chrome"] as const;

function rolesOf(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  return [...(theme === "light" ? tokens.light : tokens.dark).keys()];
}

function alarmFamily(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  return rolesOf(theme, tokens).filter((r) => /^(?:critical|warning)(?:-|$)/.test(r));
}

function infoFamily(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  return [...rolesOf(theme, tokens).filter((r) => /^info(?:-|$)/.test(r)), "simulated-ink"];
}

function accentOffenders(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  const out: string[] = [];
  for (const role of ACCENT_FAMILY) {
    for (const alarm of alarmFamily(theme, tokens)) {
      const d = deltaE2000(hexOf(role, theme, tokens), hexOf(alarm, theme, tokens));
      if (!(d >= MIN_ALARM_DELTA_E)) out.push(`${role} vs ${alarm} (${theme}): ΔE2000 ${d.toFixed(2)} < ${MIN_ALARM_DELTA_E}`);
    }
    for (const state of infoFamily(theme, tokens)) {
      const d = deltaE2000(hexOf(role, theme, tokens), hexOf(state, theme, tokens));
      if (!(d >= MIN_ACCENT_STATE_DELTA_E)) out.push(`${role} vs ${state} (${theme}): ΔE2000 ${d.toFixed(2)} < ${MIN_ACCENT_STATE_DELTA_E}`);
    }
  }
  return out;
}

/** A4b: no series role equals `accent`, and each is ≥ 12 from `info` (S1 already holds ≥ 20 from the alarms). */
function seriesAccentOffenders(theme: Theme, tokens: ReturnType<typeof loadTokens>): string[] {
  const out: string[] = [];
  const accent = hexOf("accent", theme, tokens).toLowerCase();
  for (const role of seriesRolesOf(theme, tokens)) {
    const hex = hexOf(role, theme, tokens).toLowerCase();
    if (hex === accent) out.push(`${role} equals accent (${theme}) ${hex}`);
    const d = deltaE2000(hex, hexOf("info", theme, tokens));
    if (!(d >= MIN_ACCENT_STATE_DELTA_E)) out.push(`${role} vs info (${theme}): ΔE2000 ${d.toFixed(2)} < ${MIN_ACCENT_STATE_DELTA_E}`);
  }
  return out;
}

/**
 * `F4.341` (ADR 0118 decision 14) — the grounds a design system paints beyond the base vocabulary,
 * as pairs measured once per profile × theme (not per combination). No allowlist and no carry-over:
 * a design system's own ground must pass everywhere. Each design system's PR adds its rows.
 */
const DS_TEXT_PAIRS: Record<string, Pair[]> = {
  // PR 8: the sidebar's active item, `accent-strong` text on an `accent` 12% wash over `surface`.
  "enterprise-flat": [{ fg: "accent-strong", bg: "surface", wash: { tint: "accent", alpha: 0.12 } }],
  // PR 9: the rail's labels (`ink-muted`, `ink`) on the rail's `canvas` and the cards' `surface` are
  // base pairs already; its one new ground is none.
  "control-room-dark": [],
};
const DS_UI_PAIRS: Record<string, Pair[]> = {
  "enterprise-flat": [],
  // PR 9: paints no ground beyond the base vocabulary (cards on `surface`, the page on `canvas`).
  "control-room-dark": [],
};

describe("F4.341: every design system's own grounds hold in every profile and theme (ADR 0118 decision 14)", () => {
  it("DS-T every design system's text pairs are ≥ 4.5:1 in every profile, both themes", () => {
    const pairs = Object.values(DS_TEXT_PAIRS).flat();
    expect(pairs.length).toBeGreaterThan(0);
    expect(everyProfile((_n, theme, tokens) => checkPairs(pairs, 4.5, theme, tokens, () => false))).toEqual([]);
  });

  it("DS-U every design system's UI-part pairs are ≥ 3:1 in every profile, both themes", () => {
    expect(everyProfile((_n, theme, tokens) => checkPairs(Object.values(DS_UI_PAIRS).flat(), 3, theme, tokens, () => false))).toEqual([]);
  });

  it("DS-P every design system with a block in index.css has a pair list (even an empty one)", () => {
    const css = readFileSync(TOKENS_PATH, "utf8");
    const designs = [...new Set([...css.matchAll(/html\[data-design="([a-z-]+)"\]\s*\{/g)].map((m) => m[1]))];
    expect(designs.filter((d) => !(d in DS_TEXT_PAIRS) || !(d in DS_UI_PAIRS))).toEqual([]);
  });
});

describe("F4.310: every colour profile holds the default's rules on its own values (ADR 0110 decision 5)", () => {
  it("Q5 index.css defines every non-default profile of the contract, so Q1–Q4 are not vacuous (PR D)", () => {
    expect(profilesOf().map(([name]) => name)).toEqual([...COLOUR_PROFILES]);
  });

  it("Q0 every carry-over entry is an entry of the default's allowlist", () => {
    const missing = CARRY_OVER.filter((c) => allowlistEntryFor(c, c.theme, c.threshold) === undefined).map((c) => `${c.fg} on ${c.bg} (${c.theme})`);
    expect(missing).toEqual([]);
  });

  it("Q1 every text pair is at least 4.5:1 in every profile, both themes, carry-over excepted", () => {
    const offenders = everyProfile((name, theme, tokens) =>
      name === "nexus" ? [] : checkPairs(TEXT_PAIRS, 4.5, theme, tokens, carried),
    );
    expect(offenders).toEqual([]);
  });

  it("Q2 every UI-part pair is at least 3:1 in every profile, both themes, carry-over excepted", () => {
    const offenders = everyProfile((name, theme, tokens) =>
      name === "nexus" ? [] : checkPairs(UI_PAIRS, 3, theme, tokens, carried),
    );
    expect(offenders).toEqual([]);
  });

  it("Q3 every profile's series roles keep S1 and S2", () => {
    expect(everyProfile((_name, theme, tokens) => [...alarmOffenders(theme, tokens), ...pairOffenders(theme, tokens)])).toEqual([]);
  });

  it("A4a every profile's accent, accent-strong and accent-on-chrome are ΔE2000 ≥ 20 from every critical* and warning* role and ≥ 12 from every info* role and simulated-ink", () => {
    expect(everyProfile((_name, theme, tokens) => accentOffenders(theme, tokens))).toEqual([]);
  });

  it("A4a the role families are read from the token file (the gate is not vacuous)", () => {
    const tokens = loadTokens();
    expect(alarmFamily("light", tokens).length).toBeGreaterThanOrEqual(15);
    expect(infoFamily("dark", tokens)).toEqual(["info", "info-ink", "info-wash", "info-line", "simulated-ink"]);
  });

  it("A4b no profile's series role equals its accent, and every series role is ≥ 12 from info", () => {
    expect(everyProfile((_name, theme, tokens) => seriesAccentOffenders(theme, tokens))).toEqual([]);
  });

  it("A4b the scan is live: a series equal to the accent is caught", () => {
    const tokens = loadTokens();
    const forged = { light: new Map(tokens.light), dark: new Map(tokens.dark) };
    forged.light.set("series-3", tokens.light.get("accent")!);
    expect(seriesAccentOffenders("light", forged).some((o) => o.startsWith("series-3 equals accent"))).toBe(true);
  });

  it("A4c every profile, the default included, sets series-1 … series-8 in both themes", () => {
    expect(
      everyProfile((_name, theme, tokens) => {
        const got = seriesRolesOf(theme, tokens).sort();
        return got.join() === SERIES_EXPECTED.join() ? [] : [`${theme}: ${got.join(",")}`];
      }),
    ).toEqual([]);
  });
});
