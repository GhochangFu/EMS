import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.28` (ADR 0074, owner ruling OQ1), rewritten by `F4.350` (ADR 0075 Amendment 3): the
 * freshness window has **one source**, `apps/api/src/telemetry/telemetry-cadence.ts`.
 *
 * Before `F4.350` it was a fixed 25 s (`LIVE_TELEMETRY_MAX_AGE_SECONDS`) plus a fixed 150 s
 * reporting window (`REPORTING_WINDOW_SECONDS`), and this file pinned each reader to one or the
 * other. Now an asset is live inside `clamp(2.5 x its RTU's interval, 25 s, 900 s)`. This file
 * holds that:
 *
 * - the module declares the floor and the cap as numeric literals and builds every SQL interval
 *   from them, so no reader restates a number;
 * - every SQL reader of "is this asset live" builds its CTE from the module, and none keeps a
 *   fixed `interval 'N seconds'` of its own or a `kw_time > now()` test;
 * - every JS reader of `telemetryFreshnessAt` passes the asset's window;
 * - the removed symbols are gone from the API;
 * - the web's floor (`FRESH_MS`, ADR 0027) equals the API's floor.
 */

const CADENCE = join(repoRoot, "apps/api/src/telemetry/telemetry-cadence.ts");
const FRESHNESS = join(repoRoot, "apps/api/src/telemetry/telemetry-freshness.ts");
const WEB_TELEMETRY = join(repoRoot, "apps/web/src/lib/schematic-telemetry.ts");

function numericExport(file: string, name: string): number {
  const match = readFileSync(file, "utf8").match(new RegExp(`export const ${name}\\s*=\\s*([\\d_.]+)\\s*;`));
  expect(match, `${name} must be declared as a numeric literal in ${file}`).not.toBeNull();
  return Number((match?.[1] ?? "").replace(/_/g, ""));
}

/** The source with block comments and `//` lines removed, so a docblock may name a removed symbol. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules" && name !== "dist") walk(path, out);
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

/** The top-level arguments of every `name(` call in `source`, found by balancing parentheses. */
function callsOf(source: string, name: string): string[][] {
  const calls: string[][] = [];
  let from = source.indexOf(`${name}(`);
  while (from >= 0) {
    let depth = 0;
    let arg = "";
    const args: string[] = [];
    for (let i = from + name.length; i < source.length; i++) {
      const ch = source[i] ?? "";
      if (ch === "(") {
        depth++;
        if (depth === 1) continue;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) {
          args.push(arg.trim());
          break;
        }
      } else if (ch === "," && depth === 1) {
        args.push(arg.trim());
        arg = "";
        continue;
      }
      arg += ch;
    }
    calls.push(args.filter((a) => a !== ""));
    from = source.indexOf(`${name}(`, from + 1);
  }
  return calls;
}

describe("F4.350 — the freshness window has one source (ADR 0075 Amendment 3)", () => {
  it("FRESHNESS_FLOOR_SECONDS x 1000 equals the web FRESH_MS (the web's floor)", () => {
    expect(numericExport(CADENCE, "FRESHNESS_FLOOR_SECONDS") * 1000).toBe(numericExport(WEB_TELEMETRY, "FRESH_MS"));
  });

  it("declares the floor, the cap and the factor as literals of 25, 900 and 2.5", () => {
    expect(numericExport(CADENCE, "FRESHNESS_FLOOR_SECONDS")).toBe(25);
    expect(numericExport(CADENCE, "FRESHNESS_CAP_SECONDS")).toBe(900);
    expect(numericExport(CADENCE, "FRESHNESS_INTERVAL_FACTOR")).toBe(2.5);
  });

  it("builds every SQL interval from a constant (no 'N seconds' literal in the module)", () => {
    // `interval '1 second'` is the unit a computed number of seconds is multiplied by, not a window.
    expect(code(CADENCE).match(/interval\s+'\d+\s+seconds'/gi) ?? []).toEqual([]);
    expect(code(CADENCE)).toMatch(/interval '\$\{FRESHNESS_CAP_SECONDS\} seconds'/);
  });

  it("the live CTE yields one row per asset (GROUP BY asset_id), so joining it cannot fan out a row", () => {
    expect(code(CADENCE)).toMatch(/live AS \(\s*SELECT n\.asset_id[\s\S]*GROUP BY pv\.asset_id/);
  });

  it("the live CTE prunes chunks with the cap as a plan-time literal, then applies the window to each asset's newest sample", () => {
    const source = code(CADENCE);
    const cap = source.indexOf("pv.time > now() - interval '${FRESHNESS_CAP_SECONDS} seconds'");
    const window = source.indexOf("n.newest > now() - (${ASSET_WINDOW_SECONDS_SQL}");
    expect(cap).toBeGreaterThanOrEqual(0);
    expect(window).toBeGreaterThan(cap);
  });

  it("telemetry-freshness.ts holds no window number of its own", () => {
    const source = code(FRESHNESS);
    expect(source).not.toMatch(/\b25\b|\b150\b|\b900\b/);
    expect(source).toMatch(/windowSeconds \* 1000/);
  });

  it("the removed symbols are gone from the API (fixed 25 s and 150 s windows)", () => {
    const removed = [
      "REPORTING_ASSETS_CTE_SQL",
      "REPORTING_WINDOW_SECONDS",
      "REPORTING_WINDOW_INTERVAL_SQL",
      "LIVE_WINDOW_INTERVAL_SQL",
      "LIVE_TELEMETRY_MAX_AGE_SECONDS",
    ];
    const hits: string[] = [];
    for (const file of walk(join(repoRoot, "apps/api/src"))) {
      const source = code(file);
      for (const name of removed) {
        if (source.includes(name)) hits.push(`${relative(repoRoot, file)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

/**
 * Every SQL reader of "is this asset live", and how many times it builds the shared CTE (through
 * `LIVE_ASSETS_CTE_SQL` or `liveAssetsCteSql(`).
 */
const SQL_READERS: ReadonlyArray<{ readonly file: string; readonly count: number }> = [
  // `F3.28` — the class strip, scoped to its members.
  { file: "apps/api/src/assets/asset-role-summary.service.ts", count: 1 },
  // `F3.73` — `assets.offline.count` and `assets.list`, through one shared helper.
  { file: "apps/api/src/dashboard-builder/metric-catalog.service.ts", count: 1 },
  // `F3.73` (plan D9, ruling Q6a) — the site-widgets read's per-tab offline count.
  { file: "apps/api/src/dashboard-builder/site-widgets.service.ts", count: 1 },
  // `F4.317` — `sites.live.count`, a site being a location.
  { file: "apps/api/src/dashboard-builder/metric-catalog-estate.ts", count: 1 },
  // `F3.30` — the status read, narrowed to its scope.
  { file: "apps/api/src/system-status/system-status.service.ts", count: 1 },
  // `locationKpis`, `locationDashboard`'s RTU rows, `kpis.sites_online`.
  { file: "apps/api/src/dashboard/dashboard.service.ts", count: 3 },
  // `sitesLive`'s comm-status count, which colours the pin.
  { file: "apps/api/src/map/map.service.ts", count: 1 },
];

describe.each(SQL_READERS)("F4.350 — $file builds the live CTE from telemetry-cadence.ts", ({ file, count }) => {
  const path = join(repoRoot, file);

  it("restates no interval 'N seconds' literal", () => {
    expect(code(path).match(/interval\s+'\d+\s+seconds'/gi) ?? []).toEqual([]);
  });

  it("has no kw_time > now() predicate", () => {
    expect(code(path).match(/\bkw_time\s*>\s*now\(\)/gi) ?? []).toEqual([]);
  });

  it(`builds the shared CTE exactly ${count} time(s)`, () => {
    const matches = code(path).match(/\$\{(?:sql\.raw\()?LIVE_ASSETS_CTE_SQL\)?\}|liveAssetsCteSql\(/g) ?? [];
    expect(matches.length).toBe(count);
  });

  it("imports it from telemetry-cadence", () => {
    expect(code(path)).toMatch(/from "\.\.\/telemetry\/telemetry-cadence"/);
  });
});

/** Every JS reader of `telemetryFreshnessAt`: each call passes the asset's window as a third argument. */
const JS_READERS = [
  "apps/api/src/dashboard/dashboard.service.ts",
  "apps/api/src/control-room/generated-site-view.service.ts",
  "apps/api/src/dashboard-builder/breaker-rows.ts",
  "apps/api/src/dashboard-builder/mimic-nodes.pure.ts",
];

describe.each(JS_READERS)("F4.350 — %s judges freshness on the asset's window", (file) => {
  const source = code(join(repoRoot, file));

  it("calls telemetryFreshnessAt with three arguments each time", () => {
    const calls = callsOf(source, "telemetryFreshnessAt");
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args.length, args.join(" | ")).toBe(3);
    }
  });

  it("states the window it judged on in the row (freshnessWindowSeconds) or takes it as an argument", () => {
    expect(source).toMatch(/freshnessWindowSeconds|windowSeconds/);
  });
});

/**
 * Every file that hands `telemetryFreshnessAt` a window must read it from `asset_windows`
 * (`assetWindowsCteSql`), not state one: passing a constant as the third argument would satisfy
 * the argument-count check above and still revert the asset to a fixed window.
 */
const WINDOW_SOURCES = [
  "apps/api/src/dashboard/dashboard.service.ts",
  "apps/api/src/control-room/generated-site-view.service.ts",
  "apps/api/src/dashboard-builder/breaker-rows.ts",
  "apps/api/src/dashboard-builder/mimic-nodes.service.ts",
];

describe.each(WINDOW_SOURCES)("F4.350 — %s reads each asset's window from asset_windows", (file) => {
  const source = code(join(repoRoot, file));

  it("builds the asset_windows CTE once", () => {
    expect((source.match(/assetWindowsCteSql\(/g) ?? []).length).toBe(1);
  });

  it("reads the window back per asset and passes it on", () => {
    expect(source).toMatch(/windowsByAsset\(|freshness_window_seconds|window_seconds/);
  });
});

describe("F4.350 — mimic assetOf takes the window as a required argument", () => {
  it("has no default for freshnessWindowSeconds", () => {
    const source = code(join(repoRoot, "apps/api/src/dashboard-builder/mimic-nodes.pure.ts"));
    expect(source).toMatch(/freshnessWindowSeconds: number,/);
    expect(source).not.toMatch(/freshnessWindowSeconds: number\s*=/);
  });
});
