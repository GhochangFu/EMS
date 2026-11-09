import plugin from "tailwindcss/plugin";

/*
 * `F4.341` (ADR 0118 decision 3, plan `docs/plans/f4.341-selectable-design-systems.md` D1/D8) —
 * the type, weight, case and spacing utilities emit design tokens instead of literals. The token
 * values live in `src/index.css`'s `html`-keyed design blocks; the `nexus-soft` base equals
 * Tailwind's defaults (and today's weight and case), so the emitted CSS computes to the same
 * pixels. `tests/f4.341-design-tokens.test.ts` DT1–DT3 and DT5 hold the remap and the equality.
 */

/** The text steps that carry a line height; `3xs` and `2xs` set the size only, as the arbitrary sizes they replace did. */
const TEXT_STEPS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];

/** Spacing steps 1…8 read `--space-N`; the half steps are the midpoints of their neighbours. */
const SPACE_TOKENS = {
  0.5: "calc(var(--space-1) / 2)",
  1: "var(--space-1)",
  1.5: "calc((var(--space-1) + var(--space-2)) / 2)",
  2: "var(--space-2)",
  2.5: "calc((var(--space-2) + var(--space-3)) / 2)",
  3: "var(--space-3)",
  4: "var(--space-4)",
  5: "var(--space-5)",
  6: "var(--space-6)",
  7: "var(--space-7)",
  8: "var(--space-8)",
};

/** `padding`, `gap` and `space-*` start from the stock spacing scale; margins and sizes keep it as is. */
const tokenSpacing = ({ theme }) => ({ ...theme("spacing"), ...SPACE_TOKENS });

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // D8: the core `uppercase` utility is replaced by a token-driven one (the plugin below), so a
  // design system decides whether a label is in capitals. The other three keep their values.
  corePlugins: { textTransform: false },
  // `docs/plans/f3.65a-colour-tokens.md` §3 D5 (plan OQ8): a selector-driven dark mode, never
  // `prefers-color-scheme`, so a stray `dark:` class can never follow the OS setting — the gate
  // in `tests/f3.65-colour-roles-gate.test.ts` forbids the class itself (0 today).
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    fontSize: {
      "3xs": "var(--text-3xs)",
      "2xs": "var(--text-2xs)",
      ...Object.fromEntries(TEXT_STEPS.map((k) => [k, [`var(--text-${k})`, { lineHeight: `var(--leading-${k})` }]])),
    },
    padding: tokenSpacing,
    gap: tokenSpacing,
    space: tokenSpacing,
    // `F3.65c` (plan `docs/plans/f3.65c-charts-schematics-switch.md` D9): `colors` *replaces*
    // Tailwind's palette rather than extending it, so no stock family (`gray-200`, `white` …) and
    // no `bms-*` shade emits a class — the only colours are the roles and three CSS keywords.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      // Plan §2.2 — the 40 role tokens, plus a 41st, `simulated-ink` (owner ruling 2026-09-28,
      // ADR 0078 Amendment 1 §1, added after the plan's gate). Each value is
      // `rgb(var(--role) / <alpha-value>)` so `/NN` opacity utilities (`bg-accent/20`) keep
      // working; the channel triplet itself lives in `apps/web/src/index.css`.
      // `tests/f3.65a-colour-tokens.test.ts` T11 imports this object and holds every leaf other
      // than the three keywords to exactly its own role's variable; T16 holds the absence of the
      // stock palette, `bms` and `theme.extend.colors`.
      canvas: "rgb(var(--canvas) / <alpha-value>)",
      surface: "rgb(var(--surface) / <alpha-value>)",
      well: {
        DEFAULT: "rgb(var(--well) / <alpha-value>)",
        deep: "rgb(var(--well-deep) / <alpha-value>)",
      },
      line: {
        DEFAULT: "rgb(var(--line) / <alpha-value>)",
        strong: "rgb(var(--line-strong) / <alpha-value>)",
      },
      ink: {
        DEFAULT: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--ink-muted) / <alpha-value>)",
        faint: "rgb(var(--ink-faint) / <alpha-value>)",
        hint: "rgb(var(--ink-hint) / <alpha-value>)",
      },
      "neutral-ink": "rgb(var(--neutral-ink) / <alpha-value>)",
      accent: {
        DEFAULT: "rgb(var(--accent) / <alpha-value>)",
        strong: "rgb(var(--accent-strong) / <alpha-value>)",
        // F4.310 (ADR 0110): the brand colour on the dark chrome — the wordmark.
        "on-chrome": "rgb(var(--accent-on-chrome) / <alpha-value>)",
      },
      chrome: {
        DEFAULT: "rgb(var(--chrome) / <alpha-value>)",
        nav: "rgb(var(--chrome-nav) / <alpha-value>)",
      },
      on: {
        dark: "rgb(var(--on-dark) / <alpha-value>)",
        accent: "rgb(var(--on-accent) / <alpha-value>)",
      },
      focus: "rgb(var(--focus) / <alpha-value>)",
      scrim: "rgb(var(--scrim) / <alpha-value>)",
      critical: {
        DEFAULT: "rgb(var(--critical) / <alpha-value>)",
        ink: {
          DEFAULT: "rgb(var(--critical-ink) / <alpha-value>)",
          soft: "rgb(var(--critical-ink-soft) / <alpha-value>)",
          strong: "rgb(var(--critical-ink-strong) / <alpha-value>)",
        },
        wash: {
          DEFAULT: "rgb(var(--critical-wash) / <alpha-value>)",
          strong: "rgb(var(--critical-wash-strong) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--critical-line) / <alpha-value>)",
          strong: "rgb(var(--critical-line-strong) / <alpha-value>)",
        },
        "on-dark": "rgb(var(--critical-on-dark) / <alpha-value>)",
      },
      warning: {
        DEFAULT: "rgb(var(--warning) / <alpha-value>)",
        ink: "rgb(var(--warning-ink) / <alpha-value>)",
        wash: {
          DEFAULT: "rgb(var(--warning-wash) / <alpha-value>)",
          strong: "rgb(var(--warning-wash-strong) / <alpha-value>)",
        },
        line: "rgb(var(--warning-line) / <alpha-value>)",
        "on-dark": "rgb(var(--warning-on-dark) / <alpha-value>)",
      },
      ok: {
        // F4.310 (ADR 0110): the fixed "OK / normal / energised" state, off `accent`.
        DEFAULT: "rgb(var(--ok) / <alpha-value>)",
        strong: "rgb(var(--ok-strong) / <alpha-value>)",
        ink: "rgb(var(--ok-ink) / <alpha-value>)",
        wash: "rgb(var(--ok-wash) / <alpha-value>)",
      },
      info: {
        DEFAULT: "rgb(var(--info) / <alpha-value>)",
        ink: "rgb(var(--info-ink) / <alpha-value>)",
        wash: "rgb(var(--info-wash) / <alpha-value>)",
        line: "rgb(var(--info-line) / <alpha-value>)",
      },
      "simulated-ink": "rgb(var(--simulated-ink) / <alpha-value>)",
      "series-1": "rgb(var(--series-1) / <alpha-value>)",
      "series-2": "rgb(var(--series-2) / <alpha-value>)",
      "series-3": "rgb(var(--series-3) / <alpha-value>)",
      "series-4": "rgb(var(--series-4) / <alpha-value>)",
      "series-5": "rgb(var(--series-5) / <alpha-value>)",
      "series-6": "rgb(var(--series-6) / <alpha-value>)",
      "series-7": "rgb(var(--series-7) / <alpha-value>)",
      "series-8": "rgb(var(--series-8) / <alpha-value>)",
    },
    extend: {
      fontWeight: {
        bold: "var(--weight-bold)",
        semibold: "var(--weight-semibold)",
      },
      letterSpacing: {
        wide: "var(--caps-tracking-wide)",
        wider: "var(--caps-tracking-wider)",
      },
      // F3.65b review: preflight's `border-color` on every element and the `--tw-ring-offset-color`
      // default were stock literals (`#E5E7EB`, `#fff`), so a bare `border` / `divide-y` /
      // `ring-offset-*` stayed light in dark. They now read `line` and `surface` — light values
      // `#E5E7EB` and `#FFFFFF` exactly, so no light pixel moves. Held by the colour-tokens T11 cases.
      // `ringOffsetColor.DEFAULT` carries no `<alpha-value>`: Tailwind 3.4's ring plugin copies it
      // raw into `--tw-ring-offset-color` (measured: the placeholder reached the CSS unsubstituted,
      // which would void every `ring-offset-*` shadow), while preflight substitutes it for
      // `borderColor.DEFAULT` (`rgb(var(--line) / 1)`).
      borderColor: {
        DEFAULT: "rgb(var(--line) / <alpha-value>)",
      },
      ringOffsetColor: {
        DEFAULT: "rgb(var(--surface))",
      },
      // F4.341 PR 6 (ADR 0118 decision 5, Amendment 1 A2): the families come from the design
      // tokens, so a design system names its own. `font-condensed` is not a family any more: it is
      // the body family at `font-stretch: 85%` (Plex Sans's `wdth` axis); `font-num` sets the
      // number family with tabular figures. Both are in the plugin below.
      fontFamily: {
        sans: ["var(--font-body)"],
        head: ["var(--font-head)"],
        mono: ["var(--font-mono)"],
      },
      // F4.344 (ADR 0120 decisions 7–8, plan R6): the mimic glyph state motion. Three keyframes,
      // four utilities — `pulse` and `pulse-fast` share one keyframe at two rates. Opacity and a
      // small scale only, never a colour; every cycle is ≥ 0.8 s (WCAG 2.3.1). The classes are used
      // only behind `motion-safe:` (`MIMIC_GLYPH_MOTION_CLASS`); `tests/f4.344-mimic-motion-gate`
      // MG1–MG3 hold the rates, the properties and the reduced-motion media query.
      keyframes: {
        "mimic-blink": {
          "0%": { opacity: "1" },
          "50%": { opacity: ".15" },
        },
        "mimic-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: ".45", transform: "scale(1.06)" },
        },
        "mimic-breathe": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".7" },
        },
      },
      animation: {
        "mimic-blink": "mimic-blink 1s step-end infinite",
        "mimic-pulse": "mimic-pulse 1.6s ease-in-out infinite",
        "mimic-pulse-fast": "mimic-pulse 0.8s ease-in-out infinite",
        "mimic-breathe": "mimic-breathe 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        ".uppercase": { "text-transform": "var(--caps-transform)" },
        ".lowercase": { "text-transform": "lowercase" },
        ".capitalize": { "text-transform": "capitalize" },
        ".normal-case": { "text-transform": "none" },
        ".font-condensed": { "font-family": "var(--font-body)", "font-stretch": "85%" },
        // `--font-num` with tabular figures always on: a face whose digits are proportional by
        // default (Archivo) offers `tnum`, and this turns it on (`f4.341-fonts` F6).
        ".font-num": { "font-family": "var(--font-num)", "font-variant-numeric": "tabular-nums" },
      });
    }),
  ],
};
