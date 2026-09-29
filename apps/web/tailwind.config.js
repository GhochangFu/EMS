/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // `docs/plans/f3.65a-colour-tokens.md` §3 D5 (plan OQ8): a selector-driven dark mode, never
  // `prefers-color-scheme`, so a stray `dark:` class can never follow the OS setting — the gate
  // in `tests/f3.65-colour-roles-gate.test.ts` forbids the class itself (0 today).
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
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
    },
    extend: {
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
      fontFamily: {
        sans: [
          '"IBM Plex Sans"',
          "system-ui",
          "sans-serif",
        ],
        condensed: [
          '"IBM Plex Sans Condensed"',
          '"IBM Plex Sans"',
          "system-ui",
          "sans-serif",
        ],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
