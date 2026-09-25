import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.28` (ADR 0074, owner ruling OQ1) — the class strip's offline bound is
 * stated once on each side of the wire, and the two agree.
 *
 * The API's `LIVE_TELEMETRY_MAX_AGE_SECONDS` (seconds) decides an asset's
 * `offlineCount` in `GET /assets/role-summary`; the web's `FRESH_MS`
 * (milliseconds, ADR 0027) decides when the schematic greys the same asset
 * out. Were they to drift, the strip would call an asset offline that the
 * diagram beside it still draws live. The two files live in different apps
 * with no shared import, so a source read is the only thing that can hold
 * them together.
 *
 * `F3.30` (ADR 0075 decision 2) extends the same bound to every fleet
 * freshness count: `telemetry-freshness.ts` exports `LIVE_WINDOW_INTERVAL_SQL`
 * (the plan-time interval literal) and `LIVE_ASSETS_CTE_SQL` (the shared
 * `live` CTE built from it). `FRESHNESS_SITES` below lists every file that
 * must interpolate `LIVE_ASSETS_CTE_SQL` rather than restate its own `kw`-only
 * window; units after this one add rows to it as each file moves.
 */

const FRESHNESS = join(repoRoot, "apps/api/src/telemetry/telemetry-freshness.ts");
const WEB_TELEMETRY = join(repoRoot, "apps/web/src/lib/schematic-telemetry.ts");
const SERVICE = join(repoRoot, "apps/api/src/assets/asset-role-summary.service.ts");

function numericExport(file: string, name: string): number {
  const match = readFileSync(file, "utf8").match(
    new RegExp(`export const ${name}\\s*=\\s*([\\d_]+)\\s*;`),
  );
  expect(match, `${name} must be declared as a numeric literal in ${file}`).not.toBeNull();
  return Number((match?.[1] ?? "").replace(/_/g, ""));
}

/**
 * Every file whose freshness predicate must be built from
 * `LIVE_ASSETS_CTE_SQL`, and how many times it must appear there. Rows are
 * added by the unit that moves each file (TDD per unit, plan §"Gates that
 * apply to every unit").
 */
const FRESHNESS_SITES: ReadonlyArray<{ readonly file: string; readonly count: number }> = [
  // `locationKpis`, `locationDashboard`'s RTU rows, `kpis.sites_online`.
  { file: "apps/api/src/dashboard/dashboard.service.ts", count: 3 },
];

describe("F3.28 — the offline bound has one source (ADR 0074, OQ1)", () => {
  it("LIVE_TELEMETRY_MAX_AGE_SECONDS × 1000 equals the web FRESH_MS", () => {
    const seconds = numericExport(FRESHNESS, "LIVE_TELEMETRY_MAX_AGE_SECONDS");
    const freshMs = numericExport(WEB_TELEMETRY, "FRESH_MS");
    expect(seconds * 1000).toBe(freshMs);
  });
});

describe("F3.30 — telemetry-freshness.ts declares the shared window once (ADR 0075 decision 2)", () => {
  it("declares LIVE_WINDOW_INTERVAL_SQL from the constant", () => {
    const source = readFileSync(FRESHNESS, "utf8");
    expect(source).toMatch(
      /export const LIVE_WINDOW_INTERVAL_SQL\s*=\s*`interval '\$\{LIVE_TELEMETRY_MAX_AGE_SECONDS\} seconds'`/,
    );
  });

  it("declares no restated interval 'N seconds' literal", () => {
    const source = readFileSync(FRESHNESS, "utf8");
    expect(source.match(/interval\s+'\d+\s+seconds?'/gi) ?? []).toEqual([]);
  });

  it("LIVE_ASSETS_CTE_SQL's predicate is built from LIVE_WINDOW_INTERVAL_SQL", () => {
    const source = readFileSync(FRESHNESS, "utf8");
    const cte = source.match(/export const LIVE_ASSETS_CTE_SQL\s*=\s*`([^`]*)`/);
    expect(cte, "LIVE_ASSETS_CTE_SQL must be declared as a template literal").not.toBeNull();
    expect(cte?.[1] ?? "").toMatch(/\btime > now\(\) - \$\{LIVE_WINDOW_INTERVAL_SQL\}/);
  });
});

describe("F3.30 — the role-summary service reads the shared constant (ADR 0075 decision 2)", () => {
  it("restates no interval 'N seconds' literal", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source.match(/interval\s+'\d+\s+seconds?'/gi) ?? []).toEqual([]);
  });

  it("builds LIVE_WINDOW from LIVE_WINDOW_INTERVAL_SQL (positive control)", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toMatch(/const LIVE_WINDOW\s*=\s*sql\.raw\(LIVE_WINDOW_INTERVAL_SQL\)/);
  });

  it("the live CTE compares against the window built from the constant", () => {
    const source = readFileSync(SERVICE, "utf8");
    expect(source).toMatch(/pv\.time > now\(\) - \$\{LIVE_WINDOW\}/);
  });
});

describe.each(FRESHNESS_SITES)("F3.30 — $file uses the shared live CTE", ({ file, count }) => {
  const path = join(repoRoot, file);

  it(`restates no interval 'N seconds' literal`, () => {
    const source = readFileSync(path, "utf8");
    expect(source.match(/interval\s+'\d+\s+seconds?'/gi) ?? []).toEqual([]);
  });

  it(`has no kw_time > now() predicate`, () => {
    const source = readFileSync(path, "utf8");
    expect(source.match(/\bkw_time\s*>\s*now\(\)/gi) ?? []).toEqual([]);
  });

  it(`interpolates LIVE_ASSETS_CTE_SQL exactly ${count} time(s)`, () => {
    const source = readFileSync(path, "utf8");
    const matches = source.match(/\$\{(sql\.raw\()?LIVE_ASSETS_CTE_SQL\)?\}/g) ?? [];
    expect(matches.length).toBe(count);
  });
});
