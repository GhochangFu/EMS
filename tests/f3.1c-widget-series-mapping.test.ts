import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.1c` (ADR 0047 decision 4, Amendment 2 §4) — the plain-label-to-ECharts
 * series mapping is stated exactly once, in `apps/web/src/lib/widget-catalog.ts`'s
 * `CHART_SERIES`. Neither the compiler nor a unit test can hold that on its
 * own: a hand-written `type: "bar"` elsewhere still typechecks and still
 * passes any test that only checks the *behaviour* of the file it lives in.
 * This is a static source scan, per §4.6/ADR 0014's precedent for exactly
 * this shape of rule (`tests/adr-0038-template-authoring-ui.test.ts`,
 * `tests/repo-invariants.test.ts`).
 *
 * Scoped to `apps/web/src/components/widgets/` and
 * `apps/web/src/lib/widget-*.ts` — the three pre-existing hand-written charts
 * (`load-trend-chart.tsx`, `energy-source-stack-chart.tsx`,
 * `energy-top-bar-chart.tsx`) are not configurable widgets and belong outside
 * these roots, not on an allowlist whose entries would outlive their reason.
 *
 * Allowlisted inside the roots: `widget-catalog.ts` itself (the one place the
 * mapping is allowed to exist) and every `*.spec.ts(x)` (assertions naming
 * the series kinds under test, e.g. `{ series: "bar" }`, are not the
 * production mapping this rule protects).
 *
 * If this fires, fix the builder, not the scan.
 */

const SCAN_ROOTS = [
  { dir: join(repoRoot, "apps/web/src/components/widgets"), filter: (name: string) => /\.tsx?$/.test(name) },
  { dir: join(repoRoot, "apps/web/src/lib"), filter: (name: string) => /^widget-.*\.ts$/.test(name) },
];

const ALLOWLISTED_BASENAMES = new Set(["widget-catalog.ts"]);
const isAllowlistedSpec = (name: string) => /\.spec\.tsx?$/.test(name);

/** Strips block and line comments before scanning — the repo idiom at `tests/repo-invariants.test.ts:610-612` — so a docblock explaining the rule cannot trip the rule it explains. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// A quoted ECharts series-name literal: "line", "bar", "scatter", or "area"
// (the one that does not exist as a series type — decision 4's whole point).
// The backreference requires matching quote characters, so `lineStyle` or a
// prose mention like "a bar chart" inside an unrelated word never matches;
// `areaStyle` is a bare object key and is untouched by this pattern either way.
const SERIES_LITERAL = /(["'])(line|bar|scatter|area)\1/g;

function scanFiles(): string[] {
  const found: string[] = [];
  for (const { dir, filter } of SCAN_ROOTS) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) continue;
      if (!filter(name)) continue;
      found.push(full);
    }
  }
  return found;
}

describe("F3.1c: the ECharts series mapping is stated once", () => {
  it("scanned a non-trivial number of files (a broken walk would pass vacuously)", () => {
    // 15 files exist in the two roots at F3.1c HEAD (6 components + 9 lib
    // files including specs/wrappers). Set well under that and far above
    // zero, so the walk failing silently is what this assertion catches.
    expect(scanFiles().length).toBeGreaterThan(10);
  });

  it("no file outside widget-catalog.ts/*.spec.ts(x) writes an ECharts series-name literal", () => {
    const offenders: string[] = [];

    for (const file of scanFiles()) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (ALLOWLISTED_BASENAMES.has(name) || isAllowlistedSpec(name)) continue;

      const src = stripComments(readFileSync(file, "utf8"));
      SERIES_LITERAL.lastIndex = 0;
      if (SERIES_LITERAL.test(src)) {
        offenders.push(relative(repoRoot, file).replace(/\\/g, "/"));
      }
    }

    expect(
      offenders,
      "the plain-label-to-ECharts mapping must be stated exactly once, in widget-catalog.ts's " +
        "CHART_SERIES — a second copy is the drift decision 4 exists to prevent. Read the series " +
        "type from CHART_SERIES[kind] instead of writing the ECharts name directly:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
