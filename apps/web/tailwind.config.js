/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // `docs/plans/f3.65a-colour-tokens.md` §3 D5 (plan OQ8): a selector-driven dark mode, never
  // `prefers-color-scheme`, so a stray `dark:` class can never follow the OS setting — the gate
  // in `tests/f3.65-colour-roles-gate.test.ts` forbids the class itself (0 today).
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // F3.65c deletes `bms` once the ratchet gate (tests/f3.65-colour-roles-gate.test.ts) is at
        // zero; kept here until then (plan §3 D8).
        bms: {
          green: "#00A651",
          "green-light": "#3DCD58",
          "green-dark": "#007C3C",
          header: "#1D2430",
          canvas: "#F2F4F7",
          ink: "#1A2230",
          muted: "#4A5464",
        },
        // Plan §2.2 — the 40 role tokens, plus a 41st, `simulated-ink` (owner ruling 2026-09-28,
        // ADR 0078 Amendment 1 §1, added after the plan's gate). Each value is
        // `rgb(var(--role) / <alpha-value>)` so `/NN` opacity utilities (`bg-accent/20`) keep
        // working; the channel triplet itself lives
        // in `apps/web/src/index.css`. `tests/f3.65a-colour-tokens.test.ts` T11 imports this object
        // and holds every leaf outside `bms` to exactly its own role's variable.
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
