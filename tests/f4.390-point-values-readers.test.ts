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
 * reader that loses its bound shows up as the same count, so each literal-bounded file must also
 * still contain its own bound text at least once per read ({@link LITERAL_BOUNDS}: for the drizzle
 * file the `sql.raw(…)` that keeps it text, not a bind parameter), and none may contain the shape
 * the planner cannot prune at plan time: a `now() - … $n` bound or a `|| ' seconds'` interval built
 * from a parameter. Comments are stripped first, so a docblock may name a table it does not read. The open rows are follow-ups: `F4.391` (rule and alarm latest
 * reads), `F4.392` (the `kw` latest reads, fix 4), `F4.393` (measure, then bound the rest); the
 * health roll-up is fix 5, behind an owner gate.
 *
 * `F4.393` (plan §1 D1, measured §2): what the planner removes before it runs is `time > now() -
 * interval 'N unit'` with ONE interval literal, and `time <op> $n::timestamptz` (a bound
 * parameter compared to `time` directly, or minus one interval literal). `now()` minus anything
 * else — `15 * interval '1 minute'`, `$n::int * interval '1 second'`, `make_interval(…)` — is
 * pruned only at executor startup, after every chunk was planned; a bound naming a lateral
 * column only per loop at run time. {@link PINNED_BOUNDS} holds each bound `F4.393` adds or
 * confirms by its exact text and count, and `telemetry/point-values-plan-shape.integration.spec.ts`
 * holds the property itself (the chunks in the plan).
 */

/**
 * File (relative to `apps/api/src`) → raw `point_values` reads; the bound and disposition per plan
 * §4. 26 reads in 18 files once PR 1 is in.
 */
const READERS: Record<string, number> = {
  // Day literals (PR 1).
  "dashboard/latest-points.ts": 1,
  // `:94`, no bound; was 2 before PR 1 — `F4.392`.
  "dashboard/dashboard.service.ts": 1,
  // Literal interval after this PR (`INPUT_READ_BOUND_INTERVAL_SQL`).
  "calc/calc-inputs.service.ts": 2,
  // Literal bound already.
  "control-room/generated-site-view.service.ts": 1,
  "dashboard-builder/breaker-rows.ts": 1,
  "dashboard-builder/mimic-nodes.service.ts": 1,
  "telemetry/telemetry-cadence.ts": 1,
  // `F4.393`: `recentForPoint` one interval literal (was `n * interval '1 minute'`, pruned only at
  // startup); `pointValuesAt` and `pointRawRecords` upper-only (PR 3, staged); `latestPointValues`
  // a `$3::timestamptz` floor, planned away — pinned.
  "telemetry/telemetry.service.ts": 4,
  // None / upper only — `F4.392`.
  "dashboard/estate-energy.ts": 1,
  "dashboard/kpi-prior.ts": 1,
  // None — `F4.391`.
  "rules/rule-samples.ts": 2,
  "alarms/alarm-details.service.ts": 1,
  // `F4.393`: live `now() - ${PUE_LATEST_WINDOW_SQL}`; `at` `(at − 900 s, at]` from a parameter.
  "telemetry/pue-ratio.ts": 1,
  // `F4.393` PR 2: per-row lateral bounds, all chunks planned twice — envelope owed.
  "calc/calc-windows.service.ts": 2,
  "tariffs/register-read.ts": 2,
  // `F4.393`: `readSamples` per-row (PR 2, envelope owed); `readInputTimes` a parameter range.
  "calc-backfill/calc-backfill-reads.ts": 2,
  // `F4.393`: the per-asset bound plus the widest bound as a literal envelope.
  "dashboard-builder/sustainability-rollup.ts": 1,
  // Fix 5, owner gate.
  "asset-health/health-rollup-sql.ts": 1,
};

/**
 * The files whose every raw read carries a plan-time literal bound → that bound's exact source
 * text, which must appear at least once per read. Deleting a bound, or turning it into a bind
 * parameter, removes the text.
 */
const LITERAL_BOUNDS: Record<string, string> = {
  "dashboard/latest-points.ts": "v.time >= timestamptz '${fromDay} 00:00:00+00' AND v.time < timestamptz '${toDay} 00:00:00+00'",
  "calc/calc-inputs.service.ts": "time > now() - ${INPUT_READ_BOUND_INTERVAL_SQL}",
  "control-room/generated-site-view.service.ts": "pv.time > now() - ${GENERATED_LATEST_WINDOW_SQL}",
  "dashboard-builder/breaker-rows.ts": "pv.time > now() - ${sql.raw(generatedSiteView.GENERATED_LATEST_WINDOW_SQL)}",
  "dashboard-builder/mimic-nodes.service.ts": "pv.time > now() - ${generatedSiteView.GENERATED_LATEST_WINDOW_SQL}",
  "telemetry/telemetry-cadence.ts": "pv.time > now() - interval '${FRESHNESS_CAP_SECONDS} seconds'",
  "telemetry/pue-ratio.ts": "time > now() - ${PUE_LATEST_WINDOW_SQL}",
  "dashboard-builder/sustainability-rollup.ts": "AND v.time > now() - ${envelope}",
};

/**
 * `F4.393` (plan D8) — file → `[bound text, exact count]`: each text must appear exactly that
 * many times in the comment-stripped source. A bound parameter compared to `time` directly is
 * planned away like a literal (plan §2), so these hold the parameter bounds and the mixed file
 * `telemetry.service.ts`, where a literal and parameter bounds sit side by side.
 */
const PINNED_BOUNDS: Record<string, readonly (readonly [string, number])[]> = {
  "telemetry/pue-ratio.ts": [["time > $2::timestamptz - ${PUE_LATEST_WINDOW_SQL} AND time <= $2::timestamptz", 1]],
  "dashboard-builder/sustainability-rollup.ts": [["AND v.time > ${at.toISOString()}::timestamptz - ${envelope}", 1]],
  "telemetry/telemetry.service.ts": [
    // `recentForPoint`: one interval literal, built from `parseWindow`'s integer.
    ["gte(pointValues.time, sql`now() - ${intervalExpr}`)", 1],
    ["sql.raw(`interval '${n} ${unit === \"m\" ? \"minutes\" : \"hours\"}'`)", 1],
    // `latestPointValues`: a bound `timestamptz` floor.
    ["AND pv.time > $3::timestamptz", 1],
  ],
  // `F4.393` PR 2: the batch's envelope as bound parameters, in both laterals.
  "tariffs/register-read.ts": [["AND v.time >= $6 AND v.time < $7", 2]],
  "calc/calc-windows.service.ts": [["AND v.time >= $6 AND v.time < $7", 2]],
};

/** The files whose `now()` bound must be one interval literal, never a multiplied unit interval. */
const NO_MULTIPLIED_INTERVAL = ["telemetry/pue-ratio.ts", "telemetry/telemetry.service.ts"];

const RAW_READ = /\b(FROM|JOIN)\s+telemetry\.point_values(?![_\w])/gi;
const DRIZZLE_READ = /\.(from|(inner|left|right|full)Join)\(\s*pointValues\b/g;
/** A `time > now() - …` bound that ends in a bound parameter: pruned only at execution, if at all. */
const PARAMETER_NOW_BOUND = /\btime\s*>=?\s*now\(\)\s*-\s*[^'\n]*\$\d/;
const PARAMETER_SECONDS = /\|\|\s*' seconds'/;
/**
 * `F4.393` — a multiplied unit interval (`n * interval '1 minute'`): pruned only at startup when
 * it bounds `time` from `now()`. Not a global rule: `telemetry-cadence.ts` multiplies on a
 * derived column, not on the hypertable bound.
 */
const MULTIPLIED_INTERVAL = /\*\s*interval\s+'1 /;

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

/** Production API sources: no `*.spec.ts`, no `*.test.ts`, nothing under `apps/api/src/testing/`. */
function apiSources(dir: string = API_SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "dist" && path !== join(API_SRC, "testing")) apiSources(path, out);
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
    expect(readsIn("db.select().from(assets).innerJoin(pointValues, on)")).toBe(1);
    expect(readsIn("select 1 from telemetry.point_values where")).toBe(1);
    expect(PARAMETER_NOW_BOUND.test("AND time > now() - ($3 || ' seconds')::interval")).toBe(true);
    expect(PARAMETER_NOW_BOUND.test("AND v.time > now() - $2::interval")).toBe(true);
    expect(PARAMETER_NOW_BOUND.test("AND time > now() - interval '604800 seconds'")).toBe(false);
    expect(PARAMETER_SECONDS.test("($3 || ' seconds')::interval")).toBe(true);
    expect(MULTIPLIED_INTERVAL.test("`${n} * interval '1 minute'`")).toBe(true);
    expect(MULTIPLIED_INTERVAL.test("($2::int * interval '1 second')")).toBe(true);
    expect(MULTIPLIED_INTERVAL.test("interval '15 minutes'")).toBe(false);
    expect(readsIn(withoutComments("/** FROM telemetry.point_values */\n// JOIN telemetry.point_values\nx"))).toBe(0);
  });

  it("every raw reader is in the inventory, with today's count", () => {
    const found: Record<string, number> = {};
    for (const file of apiSources()) {
      const n = readsIn(code(file));
      if (n > 0) found[rel(file)] = n;
    }
    expect(
      Object.keys(found).length,
      "the walk found almost no reader — the walk or the pattern is broken, and the comparison below would mean nothing",
    ).toBeGreaterThanOrEqual(10);
    expect(
      found,
      "the raw telemetry.point_values readers changed. A new reader must carry a plan-time literal time bound " +
        "(§4.4) and be added to READERS with that bound stated; a removed one must leave the table.",
    ).toEqual(READERS);
  });

  it.each(Object.entries(LITERAL_BOUNDS))("%s keeps its plan-time literal bound, never a parameter one", (file, bound) => {
    const source = code(join(API_SRC, file));
    const reads = readsIn(source);
    expect(reads, `${file}: control, the file still reads point_values`).toBeGreaterThan(0);
    expect(
      source.split(bound).length - 1,
      `${file}: its literal bound (${bound}) must appear at least once per raw read`,
    ).toBeGreaterThanOrEqual(reads);
    expect(PARAMETER_NOW_BOUND.test(source), `${file}: a time bound of now() minus a bound parameter`).toBe(false);
    expect(PARAMETER_SECONDS.test(source), `${file}: an interval built as $n || ' seconds'`).toBe(false);
  });

  describe.each(Object.entries(PINNED_BOUNDS))("%s pins its bounds (F4.393)", (file, pins) => {
    it.each(pins.map(([text, count]) => [text, count] as const))("%s appears exactly %d time(s)", (text, count) => {
      const source = code(join(API_SRC, file));
      expect(source.split(text).length - 1, `${file}: ${text}`).toBe(count);
    });
  });

  it.each(NO_MULTIPLIED_INTERVAL)("%s bounds time by one interval literal, never a multiplied unit interval", (file) => {
    const source = code(join(API_SRC, file));
    expect(MULTIPLIED_INTERVAL.test(source), `${file}: n * interval '1 …'`).toBe(false);
  });

  it("the calc input reads both bound time by the module's literal interval", () => {
    const source = code(join(API_SRC, "calc/calc-inputs.service.ts"));
    const uses = source.split("now() - ${INPUT_READ_BOUND_INTERVAL_SQL}").length - 1;
    expect(uses, "getLatestSamples and getLatestSamplesForPairs each bound time by the literal").toBe(2);
  });
});
