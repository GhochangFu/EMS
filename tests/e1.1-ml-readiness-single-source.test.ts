import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { THRESHOLDS } from "../packages/db/src/ml-data-readiness.js";

/**
 * E1.1 (ADR 0135, plan T3.2): the scorer's readiness gate and step 0's report
 * are one rule written in two languages.
 *
 * `apps/ml/src/bms_ml/readiness.py` decides, per point, whether the scorer may
 * forecast it; `packages/db/src/ml-data-readiness.ts` is the report the owner
 * reads to decide which class goes first. If the two thresholds drift, the
 * report says READY while the scorer refuses (or the reverse), and nobody
 * notices until a forecast is missing on the demo host.
 *
 * The Python file is parsed as text: the vitest run has no Python. Every
 * pattern carries a positive control, because a scan that matches nothing is a
 * comment, not a gate.
 */

const repoRoot = join(__dirname, "..");
const readinessPy = readFileSync(join(repoRoot, "apps/ml/src/bms_ml/readiness.py"), "utf8");

/** The value of a module-level `NAME = <number>` assignment, or undefined. */
function pythonConstant(source: string, name: string): number | undefined {
  const match = new RegExp(`^${name}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*$`, "m").exec(source);
  return match ? Number(match[1]) : undefined;
}

describe("E1.1 readiness thresholds: one source", () => {
  it("the constant reader works on a known line (positive control)", () => {
    expect(pythonConstant("A = 1\nFOO_BAR = 0.25\n", "FOO_BAR")).toBe(0.25);
    expect(pythonConstant("FOO_BAR = 3  # trailing comment\n", "FOO_BAR")).toBeUndefined();
    expect(pythonConstant(readinessPy, "LOOKBACK_DAYS")).toBe(400);
  });

  it.each([
    ["FORECASTING_MIN_DAYS", THRESHOLDS.forecastingMinDays],
    ["FORECASTING_GOOD_DAYS", THRESHOLDS.forecastingGoodDays],
    ["ANOMALY_MIN_DAYS", THRESHOLDS.anomalyMinDays],
    ["MIN_COVERAGE", THRESHOLDS.minCoverage],
  ])("readiness.py %s equals step 0's threshold", (name, expected) => {
    const actual = pythonConstant(readinessPy, name);
    expect(actual, `${name} is missing from readiness.py or is not a plain number`).toBeDefined();
    expect(actual).toBe(expected);
  });
});
