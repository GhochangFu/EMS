/**
 * `F4.341` — the design tokens (ADR 0118 decisions 2–4, plan
 * `docs/plans/f4.341-selectable-design-systems.md` D4, D8).
 *
 * A design system is a set of values for these custom properties, written in `src/index.css`
 * blocks keyed on `html` (the `nexus-soft` base and its flat variant; a later design system adds
 * its own pair keyed on `data-design`). A design system never sets a colour role: a ground or an
 * edge is a role reference such as `rgb(var(--canvas))`.
 *
 * `tests/f4.341-design-tokens.test.ts` DT4 holds that every design block defines exactly this
 * set. The shadow tokens are listed apart: they are defined only under the neumorphic variant
 * (ADR 0085), so under Flat a `box-shadow: var(--shadow-*)` computes to `none`.
 */

/** The text steps of `tailwind.config.js` `theme.fontSize`, smallest first. */
export const TEXT_STEPS = ["3xs", "2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"] as const;

/** The text steps that carry a line height (`3xs` and `2xs` set the size only). */
export const LEADING_STEPS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"] as const;

/** The spacing steps that read a token; the half steps `0.5`, `1.5`, `2.5` are their midpoints. */
export const SPACE_STEPS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export const DESIGN_TOKENS = [
  ...TEXT_STEPS.map((k) => `--text-${k}`),
  ...LEADING_STEPS.map((k) => `--leading-${k}`),
  "--text-wall-min",
  "--weight-bold",
  "--weight-semibold",
  "--caps-transform",
  "--caps-tracking-wide",
  "--caps-tracking-wider",
  ...SPACE_STEPS.map((n) => `--space-${n}`),
  "--radius-card",
  "--radius-card-sm",
  "--radius-well",
  "--radius-control",
  "--radius-button",
  "--radius-pill",
  "--card-ground",
  "--page-ground",
  "--button-edge",
] as const;

export type DesignToken = (typeof DESIGN_TOKENS)[number];

/** The neumorphic shadow tokens (ADR 0085), defined only off the flat variant. */
export const SHADOW_TOKENS = [
  "--shadow-raised",
  "--shadow-raised-sm",
  "--shadow-pressed",
  "--shadow-pressed-sm",
  "--shadow-pill",
  "--shadow-ribbon",
] as const;
