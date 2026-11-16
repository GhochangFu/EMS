import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { deltaE2000, deltaE2000Lab, forecastRoles, MIN_FORECAST_DELTA_E } from "./forecast-colours";
import { resolveRoles, type Roles } from "./theme";

/**
 * `F4.381` (the owner's AWS check of `6bec61f6`, 2026-11-16; the owner's ruling the same day: pick
 * the roles in code) — the first actual, past-forecast and live-forecast colours are each at least
 * ΔE2000 20 apart. Under `sand` the actual `#155E75` and the past `#0F766E` were 16.6 apart and read
 * as one colour. Entry point: `forecast-colours.test.ts`. Every profile in both themes is held by
 * `tests/f4.381-forecast-colours-distinct.test.ts`.
 */

/** The base light roles with some series roles replaced by `#RRGGBB` values. */
function rolesWith(series: Record<string, string>): Roles {
  const base = resolveRoles(fromTokenMap(ROLE_TOKENS.light));
  const out: Record<string, string> = { ...base };
  for (const [role, hex] of Object.entries(series)) {
    const n = Number.parseInt(hex.slice(1), 16);
    out[role] = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return out as Roles;
}

/** ΔE2000 matches Sharma, Wu and Dalal (2005), Table 1 — pairs 1, 7, 17 and 25. */
export function deltaE2000MatchesTheReferenceData(): void {
  expect(deltaE2000Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
  expect(deltaE2000Lab([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
  expect(deltaE2000Lab([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  expect(deltaE2000Lab([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387])).toBeCloseTo(1.2644, 4);
  expect(deltaE2000("rgb(21, 94, 117)", "rgb(15, 118, 110)"), "sand light: the AWS demo's pair").toBeCloseTo(16.6, 1);
  expect(() => deltaE2000("#155E75", "rgb(15, 118, 110)")).toThrow(/rgb/);
}

/** Where `series-2` and `series-3` hold the rule, they stay: the ruled colours (ADR 0135, F4.377). */
export function theRuledRolesStayWhereTheyHold(): void {
  const roles = rolesWith({ "series-1": "#0072B2", "series-2": "#009E73", "series-3": "#CC79A7" });
  expect(forecastRoles(roles)).toEqual({
    past: ["series-2", "series-6", "series-7", "series-8"],
    live: ["series-3", "series-4", "series-5"],
  });
}

/** `sand` light: `series-2` is too close to `series-1`, so the past line takes the next past role. */
export function aPastRoleTooCloseToTheActualIsSkipped(): void {
  const roles = rolesWith({ "series-1": "#155E75", "series-2": "#0F766E", "series-3": "#6B21A8", "series-6": "#4D7C0F" });
  expect(forecastRoles(roles)).toEqual({
    past: ["series-6", "series-2", "series-7", "series-8"],
    live: ["series-3", "series-4", "series-5"],
  });
}

/** The default light theme: `series-3` is too close to `series-1`, so the live forecast takes `series-4`. */
export function aLiveRoleTooCloseToTheActualIsSkipped(): void {
  const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));
  expect(deltaE2000(roles["series-1"], roles["series-3"])).toBeLessThan(MIN_FORECAST_DELTA_E);
  expect(forecastRoles(roles)).toEqual({
    past: ["series-2", "series-6", "series-7", "series-8"],
    live: ["series-4", "series-3", "series-5"],
  });
}

/** A live role too close to the chosen past role is skipped too (all three pairs count). */
export function aLiveRoleTooCloseToThePastIsSkipped(): void {
  const roles = rolesWith({ "series-1": "#1D4ED8", "series-2": "#0F766E", "series-3": "#14776F", "series-4": "#C026D3" });
  expect(forecastRoles(roles).live[0]).toBe("series-4");
}

/**
 * A past role far from the actual but with no live partner is skipped: `series-2` is far from
 * `series-1` but within 20 of every live role, so the past line takes `series-6`.
 */
export function aPastRoleWithNoLivePartnerIsSkipped(): void {
  const roles = rolesWith({
    "series-1": "#1D4ED8",
    "series-2": "#0F766E",
    "series-3": "#10776F",
    "series-4": "#0E756D",
    "series-5": "#117870",
    "series-6": "#C026D3",
  });
  expect(forecastRoles(roles).past[0]).toBe("series-6");
  expect(forecastRoles(roles).live[0]).toBe("series-3");
}

/** With no pair that holds, the ruled order stays (the profile gate fails such a profile first). */
export function withNoPairThatHoldsTheRuledOrderStays(): void {
  const same = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`series-${i}`, "#1D4ED8"]));
  expect(forecastRoles(rolesWith(same))).toEqual({
    past: ["series-2", "series-6", "series-7", "series-8"],
    live: ["series-3", "series-4", "series-5"],
  });
}
