import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F3.1d` (ADR 0047 decision 3, Amendment 4) — the dashboard canvas bounds are
 * stated exactly once in TypeScript, as `DASHBOARD_GRID` in
 * `packages/shared/src/contracts/dashboard-builder.ts`.
 *
 * **Why a source scan and not a unit test.** A restated `.max(12)` typechecks,
 * passes every behavioural test of the file it lives in, and stays correct
 * until the day the canvas widens — at which point one surface accepts a
 * widget another refuses, and the operator meets a 400 that names a field on a
 * dashboard that saved fine yesterday. Nothing but a static rule catches a
 * fourth copy on the day it is written. This is the shape ADR 0014 and
 * `tests/f3.1c-widget-series-mapping.test.ts` already establish.
 *
 * **The bound had four TypeScript sites before this row, and the count was
 * undercounted twice while `F3.1d` was being planned and built** — which is
 * the argument for the scan, not a footnote to it. The plan's brief said three
 * sites; the plan found a fourth (`eachWidgetFitsTheGrid`'s array-level
 * `gridX + gridW > 12`, which a field-level rewire leaves behind); the build
 * found a fifth and a sixth (`dashboardFormErrors` in
 * `apps/web/src/lib/template-dashboard-form.ts`, and a `.describe()` string
 * that named `12` in prose); and this scan, run for the first time, found a
 * seventh in `apps/api/src/admin/asset-templates/asset-templates-content.schema.ts`.
 * Three independent careful readings each missed at least one. That is what a
 * rule is for.
 *
 * **The migration is deliberately not scanned.**
 * `packages/db/drizzle/0050_configurable_dashboard_tables.sql`'s
 * `dashboard_widgets_grid_bounds_check` restates every bound and always will:
 * SQL has no imports, so this is a permanent, principled exception rather than
 * an oversight — the same shape ADR 0047 decision 2 accepts when it rules that
 * a new widget type always costs one forward migration.
 *
 * **`dashboard-builder.ts` is NOT allowlisted, and that is deliberate.** The
 * plan proposed allowlisting the declaration file. It does not need it: the
 * declaration reads `columns: 12` and `maxWidgetH: 24`, and no grid *axis*
 * token appears on those lines, so the per-line predicate below never sees
 * them. An allowlist entry that excludes nothing is a fail-open surface — it
 * would silently cover a real fourth copy added to that file later. Scanning
 * the declaration like every other file costs nothing and closes that.
 *
 * If this fires, fix the file it names — never widen the allowlist.
 */

const SCAN_ROOTS = [
  join(repoRoot, "packages/shared/src"),
  join(repoRoot, "apps/api/src"),
  join(repoRoot, "apps/web/src"),
];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);

/**
 * `*.spec.ts(x)` only. A fixture asserting a concrete coordinate
 * (`{ gridX: 11, gridW: 2 }` — the case that must be refused) is the thing
 * being tested, not the production bound this rule protects. `*.test.ts(x)`
 * mirrors are NOT exempt: they re-export a spec's runner and carry no
 * fixtures of their own, so one that grows a grid literal is a real finding.
 */
const isAllowlistedSpec = (name: string) => /\.spec\.tsx?$/.test(name);

/** Strips block and line comments before scanning — the repo idiom at `tests/repo-invariants.test.ts:610-612` — so a docblock explaining the rule cannot trip the rule it explains. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** A grid axis by either of its two spellings: the TypeScript field, or the SQL column a rewritten query might name. */
const GRID_AXIS = /\bgrid[XYWH]\b|\bgrid_[xywh]\b/;

/**
 * A bare canvas bound. `\b` on both sides is load-bearing: without it `1024`
 * matches `24` and every buffer size in the tree becomes an offender.
 * `DASHBOARD_GRID.columns - 1` is not matched — `1` is not one of these.
 */
const BARE_BOUND = /\b(?:11|12|24)\b/;

/**
 * The predicate, factored out so the positive control below can feed it a
 * **synthetic** string rather than depending on the repository's own contents.
 *
 * The plan's original control — "remove the declaration file from the
 * allowlist and expect exactly one offender" — cannot work once the rewire is
 * done correctly, because the declaration's lines carry no axis token. A
 * control that depends on the tree staying dirty passes for the wrong reason
 * and then dies the moment the tree is clean. This one cannot rot: it asserts
 * the predicate matches what it is written for and does not match the
 * rewritten form, whatever the repository happens to contain today.
 */
export function gridLiteralLines(src: string): string[] {
  return stripComments(src)
    .split(/\r?\n/)
    .filter((line) => GRID_AXIS.test(line) && BARE_BOUND.test(line));
}

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
  return SCAN_ROOTS.flatMap((root) => walk(root));
}

describe("F3.1d: the dashboard canvas bounds are stated once in TypeScript", () => {
  it("scanned a non-trivial number of files (a broken walk would pass vacuously)", () => {
    // Well over a thousand .ts/.tsx files exist across the three roots. Set far
    // under that and far above zero, so a walk that silently returns nothing —
    // a renamed root, a throw swallowed by the try/catch — fails here rather
    // than reporting a clean scan.
    expect(scanFiles().length).toBeGreaterThan(100);
  });

  it("the walk recurses: files are found inside subdirectories of each root", () => {
    for (const root of SCAN_ROOTS) {
      const found = walk(root);
      const nested = found.some((f) => /[\\/]/.test(relative(root, f)));
      expect(nested, `the walk must recurse into ${relative(repoRoot, root)}, or a nested copy is invisible to it`).toBe(
        true,
      );
    }
  });

  it("the predicate matches a restated bound and not the rewired form", () => {
    // The positive control, run against synthetic source rather than against
    // the repository. Each string below is one line of a plausible edit.
    const restated = [
      "  gridX: z.number().int().min(0).max(11),",
      "  gridW: z.number().int().min(1).max(12),",
      "  gridH: z.number().int().min(1).max(24),",
      "  .refine((widget) => widget.gridX + widget.gridW <= 12, {",
      "    if (widget.grid_x + widget.grid_w > 12) return false;",
    ].join("\n");
    expect(gridLiteralLines(restated)).toHaveLength(5);

    const rewired = [
      "  gridX: z.number().int().min(0).max(DASHBOARD_GRID.columns - 1),",
      "  gridW: z.number().int().min(DASHBOARD_GRID.minWidgetW).max(DASHBOARD_GRID.columns),",
      "  gridH: z.number().int().min(DASHBOARD_GRID.minWidgetH).max(DASHBOARD_GRID.maxWidgetH),",
      "  .refine((widget) => widget.gridX + widget.gridW <= DASHBOARD_GRID.columns, {",
      "  columns: 12,",
      "  maxWidgetH: 24,",
      "  const size = new Uint8Array(1024);",
      '  <div className="grid grid-cols-12 gap-2">',
    ].join("\n");
    expect(gridLiteralLines(rewired)).toHaveLength(0);
  });

  it("a comment restating the bound does not trip the rule it explains", () => {
    const commented = ["// gridW must not exceed 12 columns", "/* gridH: max 24 */", "  gridY: z.number().int().min(0),"].join(
      "\n",
    );
    expect(gridLiteralLines(commented)).toHaveLength(0);
  });

  it("no file outside the allowlist restates a dashboard grid bound", () => {
    const offenders: string[] = [];

    for (const file of scanFiles()) {
      const name = file.split(/[\\/]/).pop() ?? file;
      if (isAllowlistedSpec(name)) continue;

      const lines = gridLiteralLines(readFileSync(file, "utf8"));
      if (lines.length > 0) {
        offenders.push(
          `${relative(repoRoot, file).replace(/\\/g, "/")}: ${lines.map((l) => l.trim()).join(" | ")}`,
        );
      }
    }

    expect(
      offenders,
      "the dashboard canvas is declared once, as DASHBOARD_GRID in " +
        "packages/shared/src/contracts/dashboard-builder.ts. Import it — a restated 11, 12 or 24 " +
        "beside a grid axis typechecks, passes its own file's tests, and diverges the day the " +
        "canvas widens. Fix the file named here; do not add it to the allowlist. The migration " +
        "0050_configurable_dashboard_tables.sql is the one permanent exception, and it is not " +
        "scanned, because SQL has no imports.",
    ).toEqual([]);
  });
});
