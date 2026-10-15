import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.80` Task 3.3 (plan §7, OQ4) — the simulator holds the ESKOM network demo:
 * the bus coupler and the DG breaker OPEN, `NW-LT-A-F2` TRIPPED, `NW-FL-ISO-V1`
 * SHUT, the control valve and the damper OPEN, `NW-DG-1` off load, the pump running. Bus B
 * carries no load, and branch A's kW stays at the control-room scale (review finding).
 *
 * Reads `apps/sim/src/index.js` as text, on `tests/f3.74-sim-breaker-trip.test.ts`'s
 * precedent — `apps/sim` is not a Vitest project.
 */

const simEntry = fileURLToPath(new URL("../apps/sim/src/index.js", import.meta.url));
const require = createRequire(import.meta.url);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = stripComments(readFileSync(simEntry, "utf8"));

function bodyOf(name: string): string {
  const start = code.indexOf(`function ${name}(`);
  expect(start, `${name}() is missing from apps/sim/src/index.js`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("\n}\n", start);
  expect(end, `${name}() has no closing brace at column 0`).toBeGreaterThan(start);
  return code.slice(start, end);
}

function constOf(name: string): string {
  const start = code.indexOf(`const ${name} = {`);
  expect(start, `${name} is missing from apps/sim/src/index.js`).toBeGreaterThanOrEqual(0);
  const end = code.indexOf("\n};\n", start);
  expect(end, `${name} has no closing brace at column 0`).toBeGreaterThan(start);
  return code.slice(start, end);
}

function entryOf(table: string, codeName: string): string {
  const matches = [...constOf(table).matchAll(new RegExp(`"${codeName}":\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `${table} has exactly one "${codeName}" entry`).toBe(1);
  return matches[0][1];
}

const BREAKERS = ["GRID-CB", "COUPLER", "DG-CB", "OUT-CB", "LT-A-F1", "LT-A-F2", "ISO-B", "LT-B-F1"];
const breakerCode = (c: string): string => (c === "GRID-CB" || c === "OUT-CB" || c === "COUPLER" || c === "DG-CB" || c === "ISO-B" ? `NW-HT-${c}` : `NW-${c}`);

describe("F3.80 — simulator network demo", () => {
  it("the coupler and the DG breaker are held open", () => {
    for (const c of ["NW-HT-COUPLER", "NW-HT-DG-CB"]) {
      const p = entryOf("NETWORK_BREAKER_PROFILES", c);
      expect(p, c).toMatch(/\bbreaker:\s*0\b/);
      expect(p, c).toMatch(/\btrip:\s*0\b/);
    }
  });

  it("every network breaker has a profile with a trip value", () => {
    for (const c of BREAKERS) {
      expect(entryOf("NETWORK_BREAKER_PROFILES", breakerCode(c)), c).toMatch(/\btrip:\s*[01]\b/);
    }
  });

  it("LT-A-F2 is the only NW profile with trip 1", () => {
    const ones = [...constOf("NETWORK_BREAKER_PROFILES").matchAll(/"(NW-[\w-]+)":\s*\{[^}]*\btrip:\s*1\b/g)].map((m) => m[1]);
    expect(ones).toEqual(["NW-LT-A-F2"]);
    expect(entryOf("NETWORK_BREAKER_PROFILES", "NW-LT-A-F2")).toMatch(/\bbreaker:\s*0\b/);
  });

  it("the other breakers are closed", () => {
    for (const c of ["NW-HT-GRID-CB", "NW-HT-OUT-CB", "NW-LT-A-F1", "NW-HT-ISO-B", "NW-LT-B-F1"]) {
      expect(entryOf("NETWORK_BREAKER_PROFILES", c), c).toMatch(/\bbreaker:\s*1\b/);
    }
  });

  it("ISO-V1 is held shut and CV open", () => {
    expect(entryOf("NETWORK_FLOW_PROFILES", "NW-FL-ISO-V1")).toMatch(/\bvalve:\s*0\b/);
    expect(entryOf("NETWORK_FLOW_PROFILES", "NW-FL-CV")).toMatch(/\bvalve:\s*1\b/);
  });

  it("the damper is open and the DG is off load", () => {
    expect(entryOf("NETWORK_FLOW_PROFILES", "NW-FL-DAMPER")).toMatch(/\bdamper:\s*1\b/);
    expect(entryOf("NETWORK_FLOW_PROFILES", "NW-DG-1")).toMatch(/\bdgOnLoad:\s*0\b/);
  });

  it("stepElectrical looks up crProfile then networkProfile, and zeroes load on an open breaker", () => {
    const body = bodyOf("stepElectrical");
    expect(body).toMatch(/crProfile\(code\)\s*\?\?\s*networkProfile\(code\)/);
    expect(body).toMatch(/profile\.breaker\s*===\s*0/);
    const coupler = entryOf("NETWORK_BREAKER_PROFILES", "NW-HT-COUPLER");
    expect(coupler).toMatch(/\bkw:\s*0\b/);
    expect(coupler).toMatch(/\bcurrent:\s*0\b/);
  });

  it("stepNetworkFlow emits valve_open for a valve profile and damper_open for a damper", () => {
    const body = bodyOf("stepNetworkFlow");
    expect(body).toMatch(/pointKey:\s*"valve_open",\s*value:\s*profile\.valve/);
    expect(body).toMatch(/pointKey:\s*"damper_open",\s*value:\s*profile\.damper/);
    expect(body).toMatch(/pointKey:\s*"dg_on_load",\s*value:\s*profile\.dgOnLoad/);
  });

  it("tick routes a flow profile to stepNetworkFlow before the domain switch", () => {
    const body = bodyOf("tick");
    const flow = body.indexOf("NETWORK_FLOW_PROFILES[row.code]");
    expect(flow).toBeGreaterThanOrEqual(0);
    expect(body).toMatch(/stepNetworkFlow\(row\.id,\s*row\.code\)/);
    expect(flow).toBeLessThan(body.indexOf("stepElectrical(row.id"));
  });

  it("the passive transformer and LT panel are held closed, with no trip key", () => {
    for (const c of ["NW-TR-A", "NW-LT-A"]) {
      const p = entryOf("NETWORK_BREAKER_PROFILES", c);
      expect(p, c).toMatch(/\bbreaker:\s*1\b/);
      expect(p, c).not.toMatch(/\btrip:/);
    }
  });

  it("bus B carries no load: ISO-B and LT-B-F1 hold kw 0 and current 0, and stepElectrical zeroes a zero-kw profile", () => {
    for (const c of ["NW-HT-ISO-B", "NW-LT-B-F1"]) {
      const p = entryOf("NETWORK_BREAKER_PROFILES", c);
      expect(p, c).toMatch(/\bkw:\s*0\b/);
      expect(p, c).toMatch(/\bcurrent:\s*0\b/);
      expect(p, c).toMatch(/\bbreaker:\s*1\b/);
    }
    expect(bodyOf("stepElectrical")).toMatch(/profile\.kw\s*===\s*0/);
  });

  it("branch A's kW falls along the series path and stays at the control-room scale", () => {
    const kw = (c: string): number => {
      const m = entryOf("NETWORK_BREAKER_PROFILES", c).match(/\bkw:\s*([\d.]+)/);
      expect(m, c).not.toBeNull();
      return Number(m![1]);
    };
    const chain = ["NW-HT-GRID-CB", "NW-HT-OUT-CB", "NW-TR-A", "NW-LT-A"].map(kw);
    for (let i = 1; i < chain.length; i += 1) expect(chain[i], `step ${i}`).toBeLessThanOrEqual(chain[i - 1]);
    expect(chain[3]).toBeGreaterThanOrEqual(kw("NW-LT-A-F1") + kw("NW-LT-A-F2"));
    // CR-UTILITY-11KV, the site's own incomer, is held at 4.8 kW.
    expect(chain[0]).toBeLessThanOrEqual(4.8);
  });

  it("the pump reports pump_status 1 through stepNetworkFlow", () => {
    expect(entryOf("NETWORK_FLOW_PROFILES", "NW-FL-PUMP")).toMatch(/\bpumpStatus:\s*1\b/);
    expect(bodyOf("stepNetworkFlow")).toMatch(/pointKey:\s*"pump_status",\s*value:\s*profile\.pumpStatus/);
  });

  it("every code in NETWORK_DEMO_ASSETS has a breaker profile or a flow profile (none falls through silent)", () => {
    const { NETWORK_DEMO_ASSETS } = require("../packages/db/dist/network-demo-seed.js") as {
      NETWORK_DEMO_ASSETS: readonly { code: string }[];
    };
    const breakerCodes = new Set([...constOf("NETWORK_BREAKER_PROFILES").matchAll(/"(NW-[\w-]+)":/g)].map((m) => m[1]));
    const flowCodes = new Set([...constOf("NETWORK_FLOW_PROFILES").matchAll(/"(NW-[\w-]+)":/g)].map((m) => m[1]));
    for (const a of NETWORK_DEMO_ASSETS) {
      expect(breakerCodes.has(a.code) || flowCodes.has(a.code), a.code).toBe(true);
    }
    for (const c of [...breakerCodes, ...flowCodes]) {
      expect(NETWORK_DEMO_ASSETS.some((a) => a.code === c), `${c} is a demo asset`).toBe(true);
    }
  });
});
