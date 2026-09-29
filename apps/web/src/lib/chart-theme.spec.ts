import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { echartsTheme, seriesPalette } from "./chart-theme";
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

export function c4TheFirstSeriesColourIsAccent(name: ThemeName): void {
  expect(themeOf(name).color[0]).toBe(rolesOf(name).accent);
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
  const strays = stringLeaves(echartsTheme(rolesOf(name)), "", [])
    .filter(([, v]) => !roles.has(v) && !(v.startsWith("rgba(") && roles.has(rgbOf(v))))
    .map(([path, v]) => `${path} = ${v}`);
  expect(strays).toEqual([]);
}

export function c5TheThemeHasStringLeavesToCheck(name: ThemeName): void {
  expect(stringLeaves(echartsTheme(rolesOf(name)), "", []).length).toBeGreaterThan(20);
}
