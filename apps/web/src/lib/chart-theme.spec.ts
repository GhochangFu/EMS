import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { anomalyMarkColour, echartsTheme, forecastPalette, pastForecastPalette, seriesPalette } from "./chart-theme";
import { deltaE2000, forecastRoles, MIN_FORECAST_DELTA_E } from "./forecast-colours";
import { NEXUS_SOFT_CHART_TYPE, resolveTypeTokens, type ChartType } from "./design";
import { resolveRoles, type Roles } from "./theme";

/**
 * `F3.65c` U2 — the ECharts theme object built from the roles (plan D2). Every case runs once per
 * theme, from the real `index.css` blocks, so a key wired to a role that happens to share a value
 * in one theme is still caught by the other.
 */

export type ThemeName = "light" | "dark";

function rolesOf(name: ThemeName): Roles {
  return resolveRoles(fromTokenMap(ROLE_TOKENS[name]));
}

type ThemeShape = {
  color: string[];
  tooltip: { backgroundColor: string };
  gauge: { detail: { color: string } };
} & Record<"valueAxis" | "categoryAxis" | "timeAxis" | "logAxis", { axisLabel: { color: string } }>;

function themeOf(name: ThemeName): ThemeShape {
  return echartsTheme(rolesOf(name)) as unknown as ThemeShape;
}

export function c1TooltipBackgroundIsSurface(name: ThemeName): void {
  expect(themeOf(name).tooltip.backgroundColor).toBe(rolesOf(name).surface);
}

const AXES = ["valueAxis", "categoryAxis", "timeAxis", "logAxis"] as const;

export function c2EveryAxisLabelIsInkMuted(name: ThemeName): void {
  const theme = themeOf(name);
  const labels = Object.fromEntries(AXES.map((axis) => [axis, theme[axis].axisLabel.color]));
  const expected = Object.fromEntries(AXES.map((axis) => [axis, rolesOf(name)["ink-muted"]]));
  expect(labels).toEqual(expected);
}

export function c3GaugeDetailIsInk(name: ThemeName): void {
  expect(themeOf(name).gauge.detail.color).toBe(rolesOf(name).ink);
}

/** `F4.341` A5c (ADR 0118 Amendment 1 A5): the first series is `series-1`, never `accent`. */
export function c4TheFirstSeriesColourIsAccent(name: ThemeName): void {
  expect(themeOf(name).color[0]).toBe(rolesOf(name)["series-1"]);
  expect(themeOf(name).color).not.toContain(rolesOf(name).accent);
}

export function c4TheThemePaletteIsTheSeriesPalette(name: ThemeName): void {
  expect(themeOf(name).color).toEqual(seriesPalette(rolesOf(name)));
}

/** Every string leaf of `value`, with its dotted path. */
function stringLeaves(value: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringLeaves(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) stringLeaves(v, path === "" ? k : `${path}.${k}`, out);
  }
  return out;
}

export function c5EveryLeafIsARoleOrARoleWithAlpha(name: ThemeName): void {
  const roles = new Set(Object.values(rolesOf(name)));
  const rgbOf = (s: string) => s.replace(/^rgba\((\d+), (\d+), (\d+), [\d.]+\)$/, (_m, r, g, b) => `rgb(${r}, ${g}, ${b})`);
  // `F4.341`: `textStyle.fontFamily` is the design system's font, the one non-colour string.
  const strays = stringLeaves(echartsTheme(rolesOf(name)), "", [])
    .filter(([path]) => path !== "textStyle.fontFamily")
    .filter(([, v]) => !roles.has(v) && !(v.startsWith("rgba(") && roles.has(rgbOf(v))))
    .map(([path, v]) => `${path} = ${v}`);
  expect(strays).toEqual([]);
}

export function c5TheThemeHasStringLeavesToCheck(name: ThemeName): void {
  expect(stringLeaves(echartsTheme(rolesOf(name)), "", []).length).toBeGreaterThan(20);
}

/** C9 — the theme's text is set in the type tokens' font and `xs` size (ADR 0118 decision 4). */
export function c9TheTextIsInTheTypeTokens(name: ThemeName): void {
  const type: ChartType = { ...NEXUS_SOFT_CHART_TYPE, fontFamily: '"Archivo", sans-serif', xs: 13 };
  const theme = echartsTheme(rolesOf(name), type) as unknown as { textStyle: { fontFamily: string; fontSize: number } };
  expect(theme.textStyle).toMatchObject({ fontFamily: '"Archivo", sans-serif', fontSize: 13 });
}

/** C10 — `resolveTypeTokens` turns rem and px tokens into pixels, names `--font-body` first, and fails closed. */
export function c10TheTypeTokensResolve(): void {
  const tokens: Record<string, string> = {
    "--text-3xs": "10px",
    "--text-2xs": " 11px",
    "--text-xs": "0.75rem",
    "--text-sm": "0.875rem",
    "--text-base": "1rem",
    "--font-body": "",
  };
  const read = (n: string) => tokens[n] ?? "";
  expect(resolveTypeTokens(read, 16, '"IBM Plex Sans", sans-serif')).toEqual({
    fontFamily: '"IBM Plex Sans", sans-serif',
    "3xs": 10,
    "2xs": 11,
    xs: 12,
    sm: 14,
    base: 16,
  });
  tokens["--font-body"] = '"Archivo", sans-serif';
  expect(resolveTypeTokens(read, 16, "x").fontFamily).toBe('"Archivo", sans-serif');
  tokens["--text-xs"] = "";
  expect(() => resolveTypeTokens(read, 16, "x")).toThrow(/--text-xs/);
}

/**
 * `F4.377` (the owner's ruling, 2026-11-16: three colours) — the actual palette, the past-forecast
 * palette and the live-forecast palette share no colour, so a forecast never takes an actual
 * line's colour and the past line never takes the live forecast's. `F4.381` (the owner's ruling,
 * 2026-11-16: pick the roles in code) — each forecast palette starts with the role `forecastRoles`
 * picks (`series-2` and `series-3` where they hold), and the three first colours are each at least
 * ΔE2000 20 apart. Every profile is `tests/f4.381-forecast-colours-distinct.test.ts`.
 */
export function c6TheActualPastAndForecastPalettesShareNoColour(name: ThemeName): void {
  const roles = rolesOf(name);
  const actual = seriesPalette(roles);
  const past = pastForecastPalette(roles);
  const future = forecastPalette(roles);
  const picked = forecastRoles(roles);
  expect(past).toEqual(picked.past.map((role) => roles[role]));
  expect(future).toEqual(picked.live.map((role) => roles[role]));
  expect(future.length).toBeGreaterThanOrEqual(3);
  expect(past.filter((c) => actual.includes(c)), "past vs actual").toEqual([]);
  expect(future.filter((c) => actual.includes(c)), "forecast vs actual").toEqual([]);
  expect(future.filter((c) => past.includes(c)), "forecast vs past").toEqual([]);
  expect(new Set(future).size, "no forecast colour twice").toBe(future.length);
  expect(new Set(past).size, "no past colour twice").toBe(past.length);
  expect(deltaE2000(actual[0], past[0]), "actual vs past").toBeGreaterThanOrEqual(MIN_FORECAST_DELTA_E);
  expect(deltaE2000(actual[0], future[0]), "actual vs forecast").toBeGreaterThanOrEqual(MIN_FORECAST_DELTA_E);
  expect(deltaE2000(past[0], future[0]), "past vs forecast").toBeGreaterThanOrEqual(MIN_FORECAST_DELTA_E);
}

/**
 * `E1.2b` / ADR 0135 Amendment 5 ruling 4(b) — the unusual-hour marks take `ink`, a role no actual,
 * past-forecast or forecast line uses, and not an alarm colour: a mark is advisory.
 */
export function c7TheAnomalyMarkSharesNoLineColour(name: ThemeName): void {
  const roles = rolesOf(name);
  const mark = anomalyMarkColour(roles);
  expect(mark).toBe(roles.ink);
  const lines = [...seriesPalette(roles), ...pastForecastPalette(roles), ...forecastPalette(roles)];
  expect(lines.includes(mark), "mark vs every line palette").toBe(false);
  expect([roles.critical, roles.warning].includes(mark), "mark vs the alarm colours").toBe(false);
}
