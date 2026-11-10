import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { FIXED_ROLES, PROFILE_ROLES } from "../apps/web/src/lib/theme";
import { channelsToHex, deltaE2000, parseProfileBlocks } from "./support/colour-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.346` (ADR 0118 Amendment 3 decision 4, plan P6) — `colour-safe`'s eight series in each theme
 * are members of the Okabe-Ito or Paul Tol palettes, as the PR's value table lists them, and none is
 * Okabe-Ito orange or vermillion (or near them: ΔE2000 ≥ 20), the members that sit by the alarm
 * roles. The S1/S2/A4b gates in `f3.65a-colour-contrast.test.ts` hold the rest.
 */
const OKABE_ITO: Record<string, string> = {
  black: "#000000",
  "sky blue": "#56B4E9",
  "bluish green": "#009E73",
  yellow: "#F0E442",
  blue: "#0072B2",
  "reddish purple": "#CC79A7",
};
const TOL: Record<string, string> = {
  "bright blue": "#4477AA",
  "bright cyan": "#66CCEE",
  "bright grey": "#BBBBBB",
  "muted indigo": "#332288",
  "muted teal": "#44AA99",
  "muted green": "#117733",
  "muted olive": "#999933",
  "muted wine": "#882255",
  "muted purple": "#AA4499",
};
const EXCLUDED = { orange: "#E69F00", vermillion: "#D55E00" };

const EXPECTED = {
  light: ["#0072B2", "#009E73", "#CC79A7", "#332288", "#117733", "#882255", "#999933", "#000000"],
  dark: ["#66CCEE", "#44AA99", "#CC79A7", "#F0E442", "#999933", "#BBBBBB", "#AA4499", "#4477AA"],
};

function colourSafeSeries(theme: "light" | "dark"): string[] {
  const css = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
  const blocks = parseProfileBlocks(css, { names: COLOUR_PROFILES, defaultName: "nexus", profileRoles: PROFILE_ROLES, fixedRoles: FIXED_ROLES });
  const block = blocks.get("colour-safe");
  if (!block) throw new Error("no colour-safe blocks in index.css");
  const map = theme === "light" ? block.light : block.dark;
  return Array.from({ length: 8 }, (_, i) => channelsToHex(map.get(`series-${i + 1}`)!).toUpperCase());
}

describe.each(["light", "dark"] as const)("F4.346 colour-safe series (%s)", (theme) => {
  it("P6 are the value table's eight, in order", () => {
    expect(colourSafeSeries(theme)).toEqual(EXPECTED[theme]);
  });

  it("P6 each is an Okabe-Ito or Paul Tol member", () => {
    const members = new Set([...Object.values(OKABE_ITO), ...Object.values(TOL)]);
    for (const hex of colourSafeSeries(theme)) expect(members.has(hex), hex).toBe(true);
  });

  it("P6 none is orange or vermillion, nor within ΔE2000 20 of them", () => {
    for (const hex of colourSafeSeries(theme)) {
      for (const [name, excluded] of Object.entries(EXCLUDED)) {
        expect(deltaE2000(hex, excluded), `${hex} vs ${name}`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});
