import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { deltaE2000 as runtimeDeltaE2000, forecastRoles, MIN_FORECAST_DELTA_E } from "../apps/web/src/lib/forecast-colours";
import { FIXED_ROLES, PROFILE_ROLES, resolveRoles, type RoleName, type Roles } from "../apps/web/src/lib/theme";
import { channelsToHex, deltaE2000, parseProfileBlocks, parseTokenBlocks, profileTokens } from "./support/colour-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.381` (the owner's AWS check of `6bec61f6`, 2026-11-16) — in every colour profile, in light
 * and in dark, the first actual colour (`series-1`), the first past-forecast colour and the first
 * live-forecast colour that `forecastRoles` picks are each at least ΔE2000 20 apart (the owner's
 * ruling, 2026-11-16: pick the roles in code; ADR 0135 F4.377: three colours). Under `sand` light
 * the actual `#155E75` and the past `#0F766E` were 16.6 apart and read as one colour.
 *
 * The distance here is `tests/support/colour-tokens.ts`'s ΔE2000, not the runtime's, so the gate
 * does not trust the code it checks; R3 holds the two equal.
 */
type Theme = "light" | "dark";

const css = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
const base = parseTokenBlocks(css);
const blocks = parseProfileBlocks(css, { names: COLOUR_PROFILES, defaultName: "nexus", profileRoles: PROFILE_ROLES, fixedRoles: FIXED_ROLES });

function rolesOf(profile: string, theme: Theme): Roles {
  const map = profileTokens(base, blocks.get(profile))[theme];
  return resolveRoles((role: RoleName) => map.get(role)?.join(" ") ?? "");
}

function hexOf(rgb: string): string {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(rgb);
  if (!m) throw new Error(`not a resolved role: ${rgb}`);
  return channelsToHex([Number(m[1]), Number(m[2]), Number(m[3])]);
}

/** Each offending pair as `profile theme a↔b ΔE`, for a readable failure. */
function offenders(pick: (roles: Roles) => { past: RoleName; live: RoleName }): string[] {
  const out: string[] = [];
  for (const profile of COLOUR_PROFILES) {
    for (const theme of ["light", "dark"] as const) {
      const roles = rolesOf(profile, theme);
      const { past, live } = pick(roles);
      const trio: [string, RoleName][] = [["actual", "series-1"], ["past", past], ["live", live]];
      for (let i = 0; i < 3; i += 1) {
        for (let j = i + 1; j < 3; j += 1) {
          const d = deltaE2000(hexOf(roles[trio[i][1]]), hexOf(roles[trio[j][1]]));
          if (d < MIN_FORECAST_DELTA_E) out.push(`${profile} ${theme} ${trio[i][0]}↔${trio[j][0]} ${d.toFixed(1)}`);
        }
      }
    }
  }
  return out;
}

const picked = (roles: Roles) => {
  const r = forecastRoles(roles);
  return { past: r.past[0], live: r.live[0] };
};

describe("F4.381 the three forecast colours are distinct in every profile (ΔE2000 ≥ 20)", () => {
  it("R1 the first actual, past and live colours are each ≥ 20 apart, every profile, light and dark", () => {
    expect(MIN_FORECAST_DELTA_E).toBe(20);
    expect(offenders(picked)).toEqual([]);
  });

  it("R1 the scan is live: the bare ruled roles (series-2, series-3) fail sand light, the AWS demo's case", () => {
    const bare = offenders(() => ({ past: "series-2", live: "series-3" }));
    expect(bare).toContain("sand light actual↔past 16.6");
    expect(COLOUR_PROFILES.length * 2).toBe(26);
  });

  it("R2 the picked roles stay in their own palettes, so the three kinds never share a role", () => {
    for (const profile of COLOUR_PROFILES) {
      for (const theme of ["light", "dark"] as const) {
        const { past, live } = forecastRoles(rolesOf(profile, theme));
        expect([...past].sort(), `${profile} ${theme} past`).toEqual(["series-2", "series-6", "series-7", "series-8"]);
        expect([...live].sort(), `${profile} ${theme} live`).toEqual(["series-3", "series-4", "series-5"]);
      }
    }
  });

  it("R3 the runtime ΔE2000 equals the gate's on every series pair of every profile", () => {
    let pairs = 0;
    for (const profile of COLOUR_PROFILES) {
      for (const theme of ["light", "dark"] as const) {
        const roles = rolesOf(profile, theme);
        for (let i = 1; i <= 8; i += 1) {
          for (let j = i + 1; j <= 8; j += 1) {
            const a = roles[`series-${i}` as RoleName];
            const b = roles[`series-${j}` as RoleName];
            expect(runtimeDeltaE2000(a, b)).toBeCloseTo(deltaE2000(hexOf(a), hexOf(b)), 9);
            pairs += 1;
          }
        }
      }
    }
    expect(pairs).toBe(26 * 28);
  });
});
