import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { COLOUR_PROFILES } from "../packages/shared/src/contracts/colour-profile";
import { repoRoot } from "./support/source-scan";

/**
 * `F4.310` PR C (ADR 0110 decision 4) — the boot script paints the first frame in the cached
 * colour profile: it sets `data-profile` from `localStorage["bms.profile"]` **only** for one of the
 * five non-default names **and only** when the persisted session (`bms-auth`) holds a token. With no
 * session (the sign-in page), any other value, or a storage that throws, it sets nothing, so the
 * page is the default. The script is run with `node:vm`, as `tests/f3.65a-theme-boot.test.ts` does.
 */
const html = readFileSync(join(repoRoot, "apps/web/index.html"), "utf8");

function bootScript(): string {
  const plain = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find((m) => !/\btype\s*=/.test(m[1]));
  if (!plain) throw new Error("no plain <script> in index.html");
  return plain[2];
}

const SESSION = JSON.stringify({ state: { accessToken: "tok", oidcIdToken: null, user: null, scope: null }, version: 0 });
const NO_TOKEN = JSON.stringify({ state: { accessToken: null, oidcIdToken: null, user: null, scope: null }, version: 0 });

/** Runs the boot script against `items` and returns the `data-profile` it set, or undefined. */
function run(items: Record<string, string> | "throws"): string | undefined {
  let profile: string | undefined;
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
          if (name === "data-profile") profile = value;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(bootScript(), sandbox);
  return profile;
}

describe("F4.310: the boot script applies the cached colour profile (ADR 0110 decision 4)", () => {
  it("PB1 a stored profile with a stored session sets data-profile, for each non-default name", () => {
    for (const name of COLOUR_PROFILES.filter((n) => n !== "nexus")) {
      expect(run({ "bms.profile": name, "bms-auth": SESSION }), name).toBe(name);
    }
  });

  // `F4.341` (ADR 0118 decision 12): with no session the script paints the cached *portal* default
  // (`tests/f4.341-design-boot.test.ts` DB2), never `bms.profile`, the last user's.
  it("PB2 no stored session (the sign-in page) never reads bms.profile", () => {
    expect(run({ "bms.profile": "ocean" })).toBeUndefined();
    expect(run({ "bms.profile": "ocean", "bms-auth": NO_TOKEN })).toBeUndefined();
    expect(run({ "bms.profile": "ocean", "bms-auth": "{not json" })).toBeUndefined();
    expect(run({ "bms.profile": "ocean", "bms.portal-appearance": JSON.stringify({ designSystem: "nexus-soft", colourProfile: "sand" }) })).toBe("sand");
  });

  it("PB3 the default, an unknown name or no key sets nothing", () => {
    for (const value of ["nexus", "teal", "Ocean", ""]) {
      expect(run({ "bms.profile": value, "bms-auth": SESSION }), value).toBeUndefined();
    }
    expect(run({ "bms-auth": SESSION })).toBeUndefined();
  });

  it("PB4 a throwing storage sets nothing and does not stop the script", () => {
    expect(run("throws")).toBeUndefined();
  });

  it("PB5 the script's name list is the contract's list", () => {
    const m = /var profiles = \[([^\]]*)\];/.exec(bootScript());
    expect(m, "a `var profiles = [...]` line").not.toBeNull();
    const names = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    expect(names).toEqual(COLOUR_PROFILES.filter((n) => n !== "nexus"));
  });
});
