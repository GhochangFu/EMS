import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `F4.300` (owner ruling 2026-11-01): every asset in the `ups` domain sends the
 * seven UPS point codes, not only the Western Cape `CR-UPS*` / `CR-BATT*` pair,
 * so each asset the `ups` segment covers has the data its trend points name.
 * Read from the source, like the other `apps/sim` gates (`f3.74`, `f3.80`).
 */
const simEntry = fileURLToPath(new URL("../apps/sim/src/index.js", import.meta.url));

/** Comments stripped first — the docblock names the symbols this file checks. */
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

const UPS_KEYS = ["load_pct", "output_voltage_v", "output_freq_hz", "battery_v", "battery_temp_c", "backup_min", "health_pct"];

describe("F4.300 — the simulator sends the UPS codes for every ups asset", () => {
  it("tick passes the asset's domain to stepElectrical", () => {
    expect(bodyOf("tick")).toContain("stepElectrical(row.id, row.code, row.domain)");
  });

  it("stepElectrical takes the domain as its third parameter", () => {
    expect(bodyOf("stepElectrical")).toMatch(/^function stepElectrical\(assetId, code = "", domain = "electrical"\)/);
  });

  it("the UPS block runs for a ups-domain asset, outside the CR- block", () => {
    const body = bodyOf("stepElectrical");
    expect(body).toContain('if (crUps || domain === "ups") {');
    const crBlock = body.indexOf('if (code.startsWith("CR-")) {');
    const upsBlock = body.indexOf('if (crUps || domain === "ups") {');
    expect(crBlock).toBeGreaterThanOrEqual(0);
    // The UPS block follows the CR- block's close, so a non-CR ups asset reaches it.
    expect(body.slice(crBlock, upsBlock)).toMatch(/\n {2}\}\n/);
  });

  it("a non-CR ups asset walks a steady load, not one derived from the CR- kW scale", () => {
    expect(bodyOf("stepElectrical")).toContain("(crUps ? Math.min(100, Math.max(0, (s.kw / 2.8) * 100)) : 45)");
  });

  it("the block still sends all seven UPS codes", () => {
    const body = bodyOf("stepElectrical");
    const block = body.slice(body.indexOf('if (crUps || domain === "ups") {'));
    for (const key of UPS_KEYS) {
      expect(block, key).toContain(`pointKey: "${key}"`);
    }
  });
});
