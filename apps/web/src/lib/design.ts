import { designSystemOrDefault } from "@bms/shared";
import type { DesignSystem } from "@bms/shared";

import { rootComputedStyle } from "./theme";

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
  "--font-body",
  "--font-head",
  "--font-num",
  "--font-mono",
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

/** `F4.341` PR 4 — the user's cached design system; written from `/auth/me`, removed at sign-out. */
export const DESIGN_STORAGE_KEY = "bms.design";

/**
 * `F4.341` PR 4 (ADR 0118 decision 12) — the cached portal default `{ designSystem, colourProfile }`,
 * written by the sign-in page from `GET /public/appearance`; the boot script paints it when there
 * is no session.
 */
export const PORTAL_APPEARANCE_STORAGE_KEY = "bms.portal-appearance";

/**
 * `F4.341` (ADR 0118 decision 6) — the shell each design system renders. `F4.346` (Amendment 3
 * decision 1): two shells; `swiss-grid` and `bento-ops` skin the sidebar with tokens only.
 */
export const SHELL_OF_DESIGN: Readonly<Record<DesignSystem, "sidebar" | "rail">> = {
  "nexus-soft": "sidebar",
  "enterprise-flat": "sidebar",
  "swiss-grid": "sidebar",
  "bento-ops": "sidebar",
  "control-room-dark": "rail",
};

/** The design system `<html>` carries now; no (or an unknown) `data-design` is the default. */
export function readDocumentDesign(): DesignSystem {
  return designSystemOrDefault(document.documentElement.getAttribute("data-design"));
}

/** `F4.341` (ADR 0118 decision 4) — the type tokens a chart reads, in pixels, and its font. */
export type ChartType = { fontFamily: string; "3xs": number; "2xs": number; xs: number; sm: number; base: number };

/** The `nexus-soft` values (`index.css`'s base block), for a caller with no document. */
export const NEXUS_SOFT_CHART_TYPE: ChartType = {
  fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
  "3xs": 10,
  "2xs": 11,
  xs: 12,
  sm: 14,
  base: 16,
};

const CHART_STEPS = ["3xs", "2xs", "xs", "sm", "base"] as const;

/** A token value in pixels: `px` as is, `rem` against the root size. Anything else throws. */
function toPx(name: string, raw: string, rootPx: number): number {
  const m = /^(\d*\.?\d+)(px|rem)$/.exec(raw.trim());
  if (!m) throw new Error(`design token ${name} is "${raw}", not a px or rem length`);
  return m[2] === "px" ? Number(m[1]) : Number(m[1]) * rootPx;
}

/**
 * The chart type tokens from `read` (a custom-property reader). `--font-body` names the font when a
 * design system sets it (PR 6); until then the page's own font. Throws on an unreadable size, as
 * `resolveRoles` does on an empty role: a chart must never fall back silently to a library size.
 */
export function resolveTypeTokens(read: (name: string) => string, rootPx: number, pageFont: string): ChartType {
  const sizes = Object.fromEntries(CHART_STEPS.map((k) => [k, toPx(`--text-${k}`, read(`--text-${k}`), rootPx)]));
  const font = read("--font-body").trim() || pageFont.trim() || NEXUS_SOFT_CHART_TYPE.fontFamily;
  return { fontFamily: font, ...sizes } as ChartType;
}

let chartTypeCache: { design: DesignSystem; type: ChartType } | null = null;

/**
 * The chart type tokens of the design system `<html>` carries now, cached per design system. With
 * no document (a node-environment caller) the `nexus-soft` values, which are the base block's.
 */
export function chartType(): ChartType {
  if (typeof document === "undefined") return NEXUS_SOFT_CHART_TYPE;
  const design = readDocumentDesign();
  if (chartTypeCache === null || chartTypeCache.design !== design) {
    const style = rootComputedStyle();
    const rootPx = Number.parseFloat(style.fontSize) || 16;
    chartTypeCache = {
      design,
      type: resolveTypeTokens((name) => style.getPropertyValue(name), rootPx, style.fontFamily),
    };
  }
  return chartTypeCache.type;
}
