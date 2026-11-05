import { describe, expect, it } from "vitest";

import { FIXED_ROLES, PROFILE_ROLES, ROLE_NAMES } from "../apps/web/src/lib/theme";

/**
 * `F4.310` (ADR 0110 decision 2, ADR 0078 Amendment 5, plan OQ2) — every role is in exactly one
 * list. A **fixed** role has one light and one dark value for every colour profile (the alarm and
 * state colours, `on-dark`, `scrim`). A **profile** (changeable) role gets a value in each
 * profile block. PR C's token parser refuses a profile block that sets a fixed role or leaves out a
 * profile role, so these two lists are what a profile may and must set.
 *
 * The lists are typed here as well as in `theme.ts`, so a role moved from one list to the other is
 * a visible change to this file, not only to the source.
 */
const FIXED = [
  "on-dark",
  "scrim",
  "critical",
  "critical-ink-soft",
  "critical-ink",
  "critical-ink-strong",
  "critical-wash",
  "critical-wash-strong",
  "critical-line",
  "critical-line-strong",
  "critical-on-dark",
  "warning",
  "warning-ink",
  "warning-wash",
  "warning-wash-strong",
  "warning-line",
  "warning-on-dark",
  "ok-ink",
  "ok-wash",
  "info",
  "info-ink",
  "info-wash",
  "info-line",
  "simulated-ink",
  "ok",
  "ok-strong",
];

const PROFILE = [
  "canvas",
  "surface",
  "well",
  "well-deep",
  "line",
  "line-strong",
  "ink",
  "ink-muted",
  "ink-faint",
  "ink-hint",
  "neutral-ink",
  "accent",
  "accent-strong",
  "chrome",
  "chrome-nav",
  "on-accent",
  "focus",
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "series-7",
  "series-8",
  "accent-on-chrome",
];

describe("F4.310: the fixed and the profile role lists (ADR 0110 decision 2)", () => {
  it("R1 FIXED_ROLES is exactly the 26 fixed roles", () => {
    expect([...FIXED_ROLES].sort()).toEqual([...FIXED].sort());
  });

  it("R2 PROFILE_ROLES is exactly the 26 changeable roles", () => {
    expect([...PROFILE_ROLES].sort()).toEqual([...PROFILE].sort());
  });

  it("R3 the two lists share no role", () => {
    const fixed = new Set<string>(FIXED_ROLES);
    expect(PROFILE_ROLES.filter((r) => fixed.has(r))).toEqual([]);
  });

  it("R4 together the two lists are exactly ROLE_NAMES (52 roles)", () => {
    expect([...FIXED_ROLES, ...PROFILE_ROLES].sort()).toEqual([...ROLE_NAMES].sort());
    expect(ROLE_NAMES).toHaveLength(52);
  });
});
