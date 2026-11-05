import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { FIXED_ROLES, PROFILE_ROLES } from "../apps/web/src/lib/theme";
import { parseProfileBlocks, parseTokenBlocks, profileTokens, type ProfileRules } from "./support/colour-tokens";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.310` PR C (ADR 0110 decision 5) — the colour-profile blocks of `index.css`: the parser fails
 * closed on every malformed shape (fixture CSS, P1–P8), and the real token file parses (P9).
 * Each profile's contrast and distance rules are `tests/f3.65a-colour-contrast.test.ts` (the
 * per-profile describe).
 */
const RULES: ProfileRules = { names: COLOUR_PROFILES, defaultName: "nexus", profileRoles: ["canvas", "accent"], fixedRoles: ["ok"] };

const block = (selector: string, lines: string): string => `${selector} {\n${lines}\n}\n`;
const LIGHT = ':root[data-profile="ocean"]:not([data-theme="dark"])';
const DARK = ':root[data-profile="ocean"][data-theme="dark"]';
const FULL = "  --canvas: 1 2 3;\n  --accent: 4 5 6;";

describe("F4.310: the profile-block parser fails closed (ADR 0110 decision 5)", () => {
  it("P1 a well-formed profile parses to its own light and dark lines", () => {
    const parsed = parseProfileBlocks(block(LIGHT, FULL) + block(DARK, "  --canvas: 7 8 9;\n  --accent: 1 1 1;"), RULES);
    expect(parsed.get("ocean")?.light.get("canvas")).toEqual([1, 2, 3]);
    expect(parsed.get("ocean")?.dark.get("canvas")).toEqual([7, 8, 9]);
  });

  it("P2 a name outside the profile list is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT.replace("ocean", "teal"), FULL), RULES)).toThrow(/"teal" is not one of/);
  });

  it("P3 a block for the default profile is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT.replace("ocean", "nexus"), FULL), RULES)).toThrow(/is the default/);
  });

  it("P4 a profile with a light block and no dark block is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT, FULL), RULES)).toThrow(/light block but no dark block/);
  });

  it("P5 a profile with a dark block and no light block is refused", () => {
    expect(() => parseProfileBlocks(block(DARK, FULL), RULES)).toThrow(/dark block but no light block/);
  });

  it("P6 a second block for the same profile and theme is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT, FULL) + block(LIGHT, FULL) + block(DARK, FULL), RULES)).toThrow(
      /second light block/,
    );
  });

  it("P7 a profile role left out is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT, "  --canvas: 1 2 3;") + block(DARK, FULL), RULES)).toThrow(
      /leaves out the profile role "accent"/,
    );
  });

  it("P8 a fixed role, or a name that is no role, is refused", () => {
    expect(() => parseProfileBlocks(block(LIGHT, `${FULL}\n  --ok: 1 1 1;`) + block(DARK, FULL), RULES)).toThrow(
      /sets the fixed role "ok"/,
    );
    expect(() => parseProfileBlocks(block(LIGHT, `${FULL}\n  --nope: 1 1 1;`) + block(DARK, FULL), RULES)).toThrow(
      /sets "nope", which is not a role/,
    );
  });

  it("P9 the real index.css parses with the real role lists, and an overlay keeps every fixed role", () => {
    const css = readFileSync(join(repoRoot, "apps/web/src/index.css"), "utf8");
    const real: ProfileRules = { names: COLOUR_PROFILES, defaultName: "nexus", profileRoles: PROFILE_ROLES, fixedRoles: FIXED_ROLES };
    const base = parseTokenBlocks(css);
    for (const [name, blocks] of parseProfileBlocks(css, real)) {
      const merged = profileTokens(base, blocks);
      for (const role of FIXED_ROLES) {
        expect(merged.light.get(role), `${name} light ${role}`).toEqual(base.light.get(role));
        expect(merged.dark.get(role), `${name} dark ${role}`).toEqual(base.dark.get(role));
      }
    }
  });
});
