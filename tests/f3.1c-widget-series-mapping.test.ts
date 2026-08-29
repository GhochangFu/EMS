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
 * **Walks all of `apps/web/src` recursively, not just the widget roots.**
 * An earlier version scoped this to `apps/web/src/components/widgets/` and
 * `apps/web/src/lib/widget-*.ts` and was non-recursive besides — a
 * compliance review planted two duplicates that both survived: one *inside*
 * the widgets root, missed only because the walk skipped directories
 * (`apps/web/src/components/widgets/charts/inner.tsx`), and one at
 * `apps/web/src/components/dashboards/chart-series-picker.tsx` — the file
 * `docs/BACKLOG.md` names as what `F3.1d` will write, and which is outside
 * both roots by construction. The row that will next need this mapping was
 * exactly the one the old scope could not see. Recursing the whole app
 * source tree removes the "which future directory" guess entirely.
 *
 * Allowlisted: `widget-catalog.ts` itself (the one place the mapping is
 * allowed to exist), every `*.spec.ts(x)` (assertions naming the series
 * kinds under test, e.g. `{ series: "bar" }`, are not the production mapping
 * this rule protects), and the three pre-existing hand-written charts that
 * predate the widget vocabulary and are not configurable widgets —
 * `load-trend-chart.tsx`, `energy-source-stack-chart.tsx`,
 * `energy-top-bar-chart.tsx`. These three are named explicitly rather than
 * matched by a pattern, so the allowlist cannot silently grow: a fourth
 * hand-written chart added later must be added here by name or it fails the
 * scan, which is the point.
 *
 * If this fires, fix the builder, not the scan.
 */

const SCAN_ROOT = join(repoRoot, "apps/web/src");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

const ALLOWLISTED_BASENAMES = new Set([
  "widget-catalog.ts",
  "load-trend-chart.tsx",
  "energy-source-stack-chart.tsx",
  "energy-top-bar-chart.tsx",
]);
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

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scanFiles(): string[] {
  return walk(SCAN_ROOT);
}

describe("F3.1c: the ECharts series mapping is stated once", () => {
  it("scanned a non-trivial number of files (a broken walk would pass vacuously)", () => {
    // 251 .ts/.tsx files exist under apps/web/src at F3.1c HEAD. Set well
    // under that and far above zero, so the walk failing silently — or
    // reverting to the old non-recursive shape — is what this catches.
    expect(scanFiles().length).toBeGreaterThan(100);
  });

  it("the walk is recursive: a file inside a subdirectory of the scan root is found", () => {
    // The positive control for the exact defect a compliance review found:
    // a non-recursive walk over apps/web/src would see zero files here,
    // since every real file lives inside a subdirectory of it.
    const found = scanFiles();
    const inSubdirectory = found.some((f) => relative(SCAN_ROOT, f).includes("/") || relative(SCAN_ROOT, f).includes("\\"));
    expect(inSubdirectory, "the walk must recurse into subdirectories, or a nested duplicate is invisible to it").toBe(
      true,
    );
  });

  it("no file outside the allowlist writes an ECharts series-name literal", () => {
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
