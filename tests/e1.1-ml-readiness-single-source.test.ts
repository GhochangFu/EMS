import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { THRESHOLDS } from "../packages/db/src/ml-data-readiness.js";
import { FORECAST_MAX_HORIZON_HOURS } from "../packages/shared/src/contracts/ml-forecasts.js";

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

/**
 * "Real" is one rule too: apps/sim skips assets whose meta.telemetrySource is
 * 'mqtt', and a measured point on an ingest-enabled RTU is field data. If the
 * scorer's eligibility read used a looser rule than step 0's report, it could
 * forecast a simulated asset the report calls simulated (ADR 0135 Context).
 * The CLI module runs `main()` on import, so both files are read as text.
 */
const REAL_PREDICATE =
  "a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled)";

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();

function between(source: string, start: string, end: string): string | undefined {
  const from = source.indexOf(start);
  if (from < 0) return undefined;
  const to = source.indexOf(end, from + start.length);
  return to < 0 ? undefined : source.slice(from + start.length, to);
}

const cliTs = readFileSync(join(repoRoot, "packages/db/src/ml-data-readiness-cli.ts"), "utf8");
const sqlPy = readFileSync(join(repoRoot, "apps/ml/src/bms_ml/db/sql.py"), "utf8");
const readinessSql = between(cliTs, "export const READINESS_SQL = `", "`;");
const eligibilitySql = between(sqlPy, 'ELIGIBILITY_SQL = """', '"""');

describe("E1.1 real-data predicate: one source", () => {
  it("the extractors and the normaliser work (positive and negative control)", () => {
    expect(between("x A = `body` ; y", "A = `", "`")).toBe("body");
    expect(between("nothing here", "A = `", "`")).toBeUndefined();
    const sample = "WHERE a.meta->>'telemetrySource' = 'mqtt'\n   OR (ap.source_kind = 'measured'\n AND r.ingest_enabled)";
    expect(normalise(sample)).toContain(REAL_PREDICATE);
    expect(normalise(sample.replace(" AND r.ingest_enabled", ""))).not.toContain(REAL_PREDICATE);
  });

  it("both statements were found", () => {
    expect(readinessSql, "READINESS_SQL not found in ml-data-readiness-cli.ts").toBeDefined();
    expect(eligibilitySql, "ELIGIBILITY_SQL not found in apps/ml/src/bms_ml/db/sql.py").toBeDefined();
  });

  it("step 0's READINESS_SQL carries the predicate", () => {
    expect(normalise(readinessSql ?? "")).toContain(REAL_PREDICATE);
  });

  it("the scorer's ELIGIBILITY_SQL carries the same predicate", () => {
    expect(normalise(eligibilitySql ?? "")).toContain(REAL_PREDICATE);
  });
});

/**
 * E1.4a (ADR 0135 Amendment 3, plan R3): the API's look-back is the scorer's
 * largest horizon. If `ML_FORECAST_HORIZON_HOURS` may grow past the contract's
 * constant, a run with a longer horizon would still hold the current hour after
 * the API stops looking for it, and its forecast would vanish from every screen.
 */
const configPy = readFileSync(join(repoRoot, "apps/ml/src/bms_ml/config.py"), "utf8");

/** The upper bound of `_integer(source, "<NAME>", default, lower, upper)`, or undefined. */
function integerUpperBound(source: string, name: string): number | undefined {
  const match = new RegExp(`_integer\\(source, "${name}", [0-9]+, [0-9]+, ([0-9]+)\\)`).exec(source);
  return match ? Number(match[1]) : undefined;
}

describe("E1.4a forecast look-back: one source", () => {
  it("the bound reader works on a known line (positive and negative control)", () => {
    expect(integerUpperBound('x = _integer(source, "FOO", 48, 1, 64)\n', "FOO")).toBe(64);
    expect(integerUpperBound('x = _integer(source, "FOO", 48, 1, upper)\n', "FOO")).toBeUndefined();
    expect(integerUpperBound(configPy, "ML_CONTEXT_HOURS")).toBe(2048);
  });

  it("FORECAST_MAX_HORIZON_HOURS equals config.py's ML_FORECAST_HORIZON_HOURS upper bound", () => {
    const upper = integerUpperBound(configPy, "ML_FORECAST_HORIZON_HOURS");
    expect(upper, "ML_FORECAST_HORIZON_HOURS is missing from config.py or its bound is not a literal").toBeDefined();
    expect(FORECAST_MAX_HORIZON_HOURS).toBe(upper);
  });
});
