import { SERIES_ROLE_NAMES } from "@bms/shared";
import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { ROLE_NAMES, readDocumentTheme, resolveRoles, withAlpha, type RoleName } from "./theme";

/**
 * `F3.65c` U1 — the role resolver (plan D1). The source is injected (`fromTokenMap` over the real
 * `index.css` blocks), so these cases do not depend on a document; R5 reads the attribute.
 */

/** The light block, with one role's read replaced. */
function lightExcept(role: RoleName, value: string): (r: RoleName) => string {
  const light = fromTokenMap(ROLE_TOKENS.light);
  return (r) => (r === role ? value : light(r));
}

export function r1ResolvesAccentFromTheLightBlock(): void {
  expect(resolveRoles(fromTokenMap(ROLE_TOKENS.light)).accent).toBe("rgb(0, 166, 81)");
}

export function r1KeysAHyphenatedRoleByItsTokenName(): void {
  expect(resolveRoles(fromTokenMap(ROLE_TOKENS.dark))["ink-muted"]).toBe("rgb(167, 178, 192)");
}

export function r2AnEmptyReadThrowsNamingTheRole(): void {
  expect(() => resolveRoles(lightExcept("well", ""))).toThrow(/"well"/);
}

export function r3AMalformedReadThrowsNamingTheRole(): void {
  expect(() => resolveRoles(lightExcept("accent", "0 166"))).toThrow(/"accent"/);
}

export function r3AChannelAbove255Throws(): void {
  expect(() => resolveRoles(lightExcept("ink", "256 0 0"))).toThrow(/"ink"/);
}

export function r4WithAlphaBuildsRgba(): void {
  expect(withAlpha("rgb(0, 166, 81)", 0.12)).toBe("rgba(0, 166, 81, 0.12)");
}

export function r4WithAlphaRejectsANonRgbString(): void {
  expect(() => withAlpha("#00a651", 0.12)).toThrow(/#00a651/);
}

export function r5DarkAttributeReadsDark(): void {
  document.documentElement.setAttribute("data-theme", "dark");
  expect(readDocumentTheme()).toBe("dark");
}

export function r5CapitalisedDarkReadsLight(): void {
  document.documentElement.setAttribute("data-theme", "Dark");
  expect(readDocumentTheme()).toBe("light");
}

export function r5MissingAttributeReadsLight(): void {
  document.documentElement.removeAttribute("data-theme");
  expect(readDocumentTheme()).toBe("light");
}

/**
 * `F4.306` (ADR 0078 Amendment 4) — a widget config stores a series colour by its
 * `@bms/shared` name (`seriesRoleSchema`), and the strip strokes `roles[name]`, so every name the
 * contract accepts must be a role the resolver resolves.
 */
export function r6EverySeriesRoleIsAResolvedRole(): void {
  const roleNames: readonly string[] = ROLE_NAMES;
  expect(SERIES_ROLE_NAMES.filter((name) => !roleNames.includes(name))).toEqual([]);
}

/** The adjacent positive: the token file gives `series-2` its Amendment 4 value in each theme. */
export function r6TheSeriesRolesResolveInBothThemes(): void {
  expect([
    resolveRoles(fromTokenMap(ROLE_TOKENS.light))["series-2"],
    resolveRoles(fromTokenMap(ROLE_TOKENS.dark))["series-2"],
  ]).toEqual(["rgb(15, 118, 110)", "rgb(45, 212, 191)"]);
}
