import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const API_SRC = join(repoRoot, "apps/api/src");

/**
 * `F4.390` (plan §4, Task 2.1) — every raw read of `telemetry.point_values` in the API, counted per
 * file, with the time bound it carries today. The class, not the instance (§4.4): a raw read with
 * no plan-time bound plans every chunk of a hypertable that keeps 730 days and gains one chunk a
 * day, so it gets slower daily. Measured on the demo host 2026-11-19: the Assets tab's unbounded
 * `DISTINCT ON` took 100,759 ms for 4 assets (PR 1 replaced it with `dashboard/latest-points.ts`),
 * and the calc input reads, bounded by a parameter, planned for 629 ms warm and 7,705 ms cold.
 *
 * A new raw reader fails this test until it is added to {@link READERS} with its bound stated. A
 * reader that loses its bound shows up as the same count, so the literal-bounded files are also
 * checked for the shape the planner cannot prune at plan time: a `now() - … $n` bound or a
 * `|| ' seconds'` interval built from a parameter. Comments are stripped first, so a docblock may
 * name a table it does not read. The open rows are follow-ups: `F4.391` (rule and alarm latest
 * reads), `F4.392` (the `kw` latest reads, fix 4), `F4.393` (measure, then bound the rest); the
 * health roll-up is fix 5, behind an owner gate.
 */

/** File (relative to `apps/api/src`) → raw `point_values` reads; the bound and disposition per plan §4. */
const READERS: Record<string, number> = {
  // Day literals (PR 1).
  "dashboard/latest-points.ts": 1,
  // `:93`, no bound; was 2 before PR 1 — `F4.392`.
  "dashboard/dashboard.service.ts": 1,
  // Literal interval after this PR (`INPUT_READ_BOUND_INTERVAL_SQL`).
  "calc/calc-inputs.service.ts": 2,
  // Literal bound already.
  "control-room/generated-site-view.service.ts": 1,
  "dashboard-builder/breaker-rows.ts": 1,
  "dashboard-builder/mimic-nodes.service.ts": 1,
  "telemetry/telemetry-cadence.ts": 1,
  // One literal; two upper-only; one absolute parameter — `F4.393`.
  "telemetry/telemetry.service.ts": 4,
  // None / upper only — `F4.392`.
  "dashboard/estate-energy.ts": 1,
  "dashboard/kpi-prior.ts": 1,
  // None — `F4.391`.
  "rules/rule-samples.ts": 2,
  "alarms/alarm-details.service.ts": 1,
  // Parameter interval, per-row or parameter range — `F4.393`.
  "telemetry/pue-ratio.ts": 1,
  "calc/calc-windows.service.ts": 2,
  "tariffs/register-read.ts": 2,
  "calc-backfill/calc-backfill-reads.ts": 2,
  "dashboard-builder/sustainability-rollup.ts": 1,
  // Fix 5, owner gate.
  "asset-health/health-rollup-sql.ts": 1,
};

/** The files whose every raw read carries a plan-time literal bound. */
const LITERAL_BOUNDED = [
  "dashboard/latest-points.ts",
  "calc/calc-inputs.service.ts",
  "control-room/generated-site-view.service.ts",
  "dashboard-builder/breaker-rows.ts",
  "dashboard-builder/mimic-nodes.service.ts",
  "telemetry/telemetry-cadence.ts",
];

const RAW_READ = /\b(FROM|JOIN)\s+telemetry\.point_values(?![_\w])/g;
const DRIZZLE_READ = /\.from\(pointValues\)/g;
/** A `time > now() - …` bound that ends in a bound parameter: pruned only at execution, if at all. */
const PARAMETER_NOW_BOUND = /\btime\s*>=?\s*now\(\)\s*-\s*[^'\n]*\$\d/;
const PARAMETER_SECONDS = /\|\|\s*' seconds'/;

/** `source` with block comments and `//` lines removed (the `tests/f3.28…` `code()` shape). */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function code(file: string): string {
  return withoutComments(readFileSync(file, "utf8"));
}

/** Production API sources: no `*.spec.ts`, no `*.test.ts`, nothing under `testing/`. */
function apiSources(dir: string = API_SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "dist" && name !== "testing") apiSources(path, out);
    } else if (name.endsWith(".ts") && !/\.(spec|test)\.ts$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function readsIn(source: string): number {
  return (source.match(RAW_READ)?.length ?? 0) + (source.match(DRIZZLE_READ)?.length ?? 0);
}

function rel(file: string): string {
  return relative(API_SRC, file).replace(/\\/g, "/");
}

describe("F4.390 — raw telemetry.point_values readers", () => {
  it("the patterns still match the shapes they count and forbid", () => {
    expect(readsIn("SELECT 1 FROM telemetry.point_values v WHERE")).toBe(1);
    expect(readsIn("JOIN telemetry.point_values pv ON")).toBe(1);
    expect(readsIn("FROM telemetry.point_values_1d d")).toBe(0);
    expect(readsIn("db.select().from(pointValues).where(x)")).toBe(1);
    expect(PARAMETER_NOW_BOUND.test("AND time > now() - ($3 || ' seconds')::interval")).toBe(true);
    expect(PARAMETER_NOW_BOUND.test("AND v.time > now() - $2::interval")).toBe(true);
    expect(PARAMETER_NOW_BOUND.test("AND time > now() - interval '604800 seconds'")).toBe(false);
    expect(PARAMETER_SECONDS.test("($3 || ' seconds')::interval")).toBe(true);
    expect(readsIn(withoutComments("/** FROM telemetry.point_values */\n// JOIN telemetry.point_values\nx"))).toBe(0);
  });

  it("every raw reader is in the inventory, with today's count", () => {
    const found: Record<string, number> = {};
    for (const file of apiSources()) {
      const n = readsIn(code(file));
      if (n > 0) found[rel(file)] = n;
    }
    const total = Object.values(found).reduce((sum, n) => sum + n, 0);
    expect(
      Object.keys(found).length,
      "the walk found almost no reader — the walk or the pattern is broken, and the comparison below would mean nothing",
    ).toBeGreaterThanOrEqual(10);
    expect(
      found,
      "the raw telemetry.point_values readers changed. A new reader must carry a plan-time literal time bound " +
        "(§4.4) and be added to READERS with that bound stated; a removed one must leave the table.",
    ).toEqual(READERS);
    expect(total, "26 raw reads once PR 1 is in").toBe(26);
  });

  it("the literal-bounded readers keep a plan-time bound, never a parameter one", () => {
    for (const file of LITERAL_BOUNDED) {
      const source = code(join(API_SRC, file));
      expect(PARAMETER_NOW_BOUND.test(source), `${file}: a time bound of now() minus a bound parameter`).toBe(false);
      expect(PARAMETER_SECONDS.test(source), `${file}: an interval built as $n || ' seconds'`).toBe(false);
    }
  });

  it("the calc input reads both bound time by the module's literal interval", () => {
    const source = code(join(API_SRC, "calc/calc-inputs.service.ts"));
    const uses = source.split("now() - ${INPUT_READ_BOUND_INTERVAL_SQL}").length - 1;
    expect(uses, "getLatestSamples and getLatestSamplesForPairs each bound time by the literal").toBe(2);
  });
});
