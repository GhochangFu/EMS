import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { DESIGN_SYSTEMS } from "../packages/shared/src/contracts/design-system";
import { DESIGN_STORAGE_KEY, PORTAL_APPEARANCE_STORAGE_KEY } from "../apps/web/src/lib/design";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.341` PR 4 (ADR 0118 decisions 4 and 12) — the boot script paints the first frame in the
 * right design system and profile for the session state, run with `node:vm` as
 * `tests/f4.310-profile-boot.test.ts` does:
 *
 *  - **DB1** a session paints the user's cache: `bms.design` (and `bms.profile`).
 *  - **DB2** no session (the sign-in page) paints the cached portal default
 *    (`bms.portal-appearance`), never the user cache.
 *  - **DB3** the defaults, an unknown name or malformed JSON set nothing.
 *  - **DB4** a throwing storage sets nothing and does not stop the script.
 *  - **DB5** the script's lists are the contracts' (defaults excluded) and its keys are the web's.
 */
const html = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");

function bootScript(): string {
  const plain = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find((m) => !/\btype\s*=/.test(m[1]));
  if (!plain) throw new Error("no plain <script> in index.html");
  return plain[2];
}

const SESSION = JSON.stringify({ state: { accessToken: "tok" }, version: 0 });
const NO_TOKEN = JSON.stringify({ state: { accessToken: null }, version: 0 });
const portal = (designSystem: string, colourProfile: string): string => JSON.stringify({ designSystem, colourProfile });

/** Runs the boot script against `items`; returns the `data-design` and `data-profile` it set. */
function run(items: Record<string, string> | "throws"): { design?: string; profile?: string } {
  const out: { design?: string; profile?: string } = {};
  const storage = {
    getItem: (key: string) => {
      if (items === "throws") throw new Error("SecurityError");
      return items[key] ?? null;
    },
  };
  const sandbox = {
    window: { localStorage: storage },
    JSON,
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => {
          if (name === "data-design") out.design = value;
          if (name === "data-profile") out.profile = value;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(bootScript(), sandbox);
  return out;
}

describe("F4.341: the boot script applies the cached design system (ADR 0118 decisions 4, 12)", () => {
  it("DB1 a session paints bms.design and bms.profile, for each non-default design system", () => {
    for (const design of DESIGN_SYSTEMS.filter((d) => d !== "nexus-soft")) {
      expect(run({ "bms.design": design, "bms.profile": "sand", "bms-auth": SESSION }), design).toEqual({ design, profile: "sand" });
    }
  });

  it("DB2 no session paints the cached portal default, never the user cache", () => {
    const user = { "bms.design": "bento-ops", "bms.profile": "forest" };
    expect(run({ ...user, "bms.portal-appearance": portal("swiss-grid", "ocean") })).toEqual({ design: "swiss-grid", profile: "ocean" });
    expect(run({ ...user, "bms-auth": NO_TOKEN, "bms.portal-appearance": portal("swiss-grid", "ocean") })).toEqual({
      design: "swiss-grid",
      profile: "ocean",
    });
    expect(run(user)).toEqual({});
    // With a session, the portal cache is not read.
    expect(run({ "bms-auth": SESSION, "bms.portal-appearance": portal("swiss-grid", "ocean") })).toEqual({});
  });

  it("DB3 the defaults, an unknown name or malformed JSON set nothing", () => {
    for (const value of ["nexus-soft", "glass-showcase", "Bento-Ops", ""]) {
      expect(run({ "bms.design": value, "bms-auth": SESSION }).design, value).toBeUndefined();
    }
    expect(run({ "bms.portal-appearance": portal("nexus-soft", "nexus") })).toEqual({});
    expect(run({ "bms.portal-appearance": "{not json" })).toEqual({});
    expect(run({ "bms-auth": "{not json", "bms.design": "bento-ops" })).toEqual({});
  });

  it("DB4 a throwing storage sets nothing and does not stop the script", () => {
    expect(run("throws")).toEqual({});
  });

  it("DB5 the script's lists are the contracts' and its keys are the web's", () => {
    const list = (name: string) => {
      const m = new RegExp(`var ${name} = \\[([^\\]]*)\\];`).exec(bootScript());
      expect(m, `a \`var ${name} = [...]\` line`).not.toBeNull();
      return (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    };
    expect(list("designs")).toEqual(DESIGN_SYSTEMS.filter((n) => n !== "nexus-soft"));
    expect(list("profiles")).toEqual(COLOUR_PROFILES.filter((n) => n !== "nexus"));
    expect(bootScript()).toContain(`"${DESIGN_STORAGE_KEY}"`);
    expect(bootScript()).toContain(`"${PORTAL_APPEARANCE_STORAGE_KEY}"`);
  });
});
