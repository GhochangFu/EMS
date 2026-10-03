import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F3.74` Task 5.3 (plan D11, ADR 0088 decision 14) — the simulator trips one
 * breaker of the Control Room demo: `CR-Q9` reports `breaker_main` 0 and
 * `breaker_trip` 1, `CR-Q11` stays OPEN (`breaker_main` 0, no trip), and every
 * other `CR-Q*` reports `breaker_trip` 0. `stepElectrical` pushes the point
 * whenever the profile carries a `trip`.
 *
 * Reads `apps/sim/src/index.js` as text, on `tests/f2.8-sim-it-load.test.ts`'s
 * precedent — `apps/sim` is not a Vitest project.
 */

const simEntry = fileURLToPath(new URL("../apps/sim/src/index.js", import.meta.url));

/** Comments stripped first — the docblocks name the symbols this file checks. */
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

/** The object literal of one `"CODE": { ... }` profile line inside crProfile. */
function profileOf(codeName: string): string {
  const matches = [...bodyOf("crProfile").matchAll(new RegExp(`"${codeName}":\\s*\\{([^}]*)\\}`, "g"))];
  expect(matches.length, `crProfile has exactly one "${codeName}" entry`).toBe(1);
  return matches[0][1];
}

describe("F3.74 — simulator breaker trip", () => {
  it("CR-Q9 is open and tripped", () => {
    const p = profileOf("CR-Q9");
    expect(p).toMatch(/\bbreaker:\s*0\b/);
    expect(p).toMatch(/\btrip:\s*1\b/);
  });

  it("CR-Q9 carries no load", () => {
    const p = profileOf("CR-Q9");
    expect(p).toMatch(/\bkw:\s*0\b/);
    expect(p).toMatch(/\bcurrent:\s*0\b/);
  });

  it("CR-Q11 is open and not tripped", () => {
    const p = profileOf("CR-Q11");
    expect(p).toMatch(/\bbreaker:\s*0\b/);
    expect(p).toMatch(/\btrip:\s*0\b/);
  });

  it.each(Array.from({ length: 12 }, (_, i) => `CR-Q${i + 1}`))("%s has a trip value", (name) => {
    expect(profileOf(name)).toMatch(/\btrip:\s*[01]\b/);
  });

  it("CR-Q9 is the only profile with trip 1", () => {
    const ones = [...bodyOf("crProfile").matchAll(/"(CR-[\w-]+)":\s*\{[^}]*\btrip:\s*1\b/g)].map((m) => m[1]);
    expect(ones).toEqual(["CR-Q9"]);
  });

  it("every other CR-Q profile is closed (breaker 1) with trip 0", () => {
    for (let n = 1; n <= 12; n++) {
      if (n === 9 || n === 11) continue;
      const p = profileOf(`CR-Q${n}`);
      expect(p, `CR-Q${n}`).toMatch(/\bbreaker:\s*1\b/);
      expect(p, `CR-Q${n}`).toMatch(/\btrip:\s*0\b/);
    }
  });

  it("stepElectrical pushes breaker_trip only when the profile has a trip", () => {
    const body = bodyOf("stepElectrical");
    expect(body).toMatch(/profile\?*\.trip\s*!==\s*undefined/);
    expect(body).toMatch(/pointKey:\s*"breaker_trip",\s*value:\s*profile\.trip/);
  });

  /**
   * A tripped or open breaker carries exactly 0 kW and 0 A: `rndWalk` around a profile of 0 still
   * wanders up to 0.3 kW and 1.5 A, so the walk is overridden after it, for both values.
   * Mutation: drop the override → red. Mutation: override only `s.kw` → red.
   */
  it("stepElectrical zeroes kW and current after the walk when the profile trips or is open", () => {
    const body = bodyOf("stepElectrical");
    const guard = body.match(
      /if\s*\(\s*profile\s*&&\s*\(\s*profile\.trip\s*===\s*1\s*\|\|\s*profile\.breaker\s*===\s*0\s*\)\s*\)\s*\{([^}]*)\}/,
    );
    expect(guard, "the trip-or-open guard").not.toBeNull();
    expect(guard?.[1]).toMatch(/\bs\.kw\s*=\s*0\s*;/);
    expect(guard?.[1]).toMatch(/\bs\.i\s*=\s*0\s*;/);
    const walk = body.search(/\bs\.kw\s*=\s*profile\s*\?/);
    expect(walk, "the kW walk").toBeGreaterThanOrEqual(0);
    expect(body.indexOf(guard?.[0] ?? "\u0000"), "the guard runs after the walk").toBeGreaterThan(walk);
    expect(body.indexOf(guard?.[0] ?? "\u0000"), "the guard runs before kVAR is derived").toBeLessThan(body.indexOf("const kvar"));
  });

  it("stepElectrical still pushes breaker_main", () => {
    expect(bodyOf("stepElectrical")).toMatch(/pointKey:\s*"breaker_main",\s*value:\s*breaker\b/);
  });
});
