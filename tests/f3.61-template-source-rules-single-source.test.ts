import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CONTRACT_FILE = "packages/shared/src/contracts/dashboard-templates.ts";
const CONTRACT_PATH = `${repoRoot}${CONTRACT_FILE}`;

/**
 * `F3.61` Task 1c (Amendment 1) — `sectionTemplateWidgetSchema`'s second
 * `superRefine` (R4 shape, R5 cap, R7 columns) must READ the shared records
 * and message templates (`WIDGET_SOURCE_SHAPES`, `WIDGET_SOURCE_CARDINALITY`,
 * `METRIC_CATALOG`, `bindingShapeMessage`, `columnNotDeclaredMessage`,
 * `duplicateColumnMessage`), never RESTATE the shape strings or the numeric
 * caps those records carry.
 *
 * **Why a source scan and not a unit test.** A restated `["metric"]` or a
 * restated `1` typechecks, passes every behavioural test in
 * `dashboard-templates.test.ts`, and stays correct until the day a shape or a
 * cap moves — at which point the template contract silently disagrees with
 * the live dashboard write path it mirrors. Nothing but a static rule catches
 * a restated copy on the day it is written. The precedent is
 * `tests/f3.1d-grid-bounds-single-source.test.ts`.
 *
 * The scan is scoped to the second `superRefine`'s block — between
 * `export const sectionTemplateWidgetSchema` and the next `export const` —
 * because the identity node above it (Rule 3, `F3.61` Task 1) is a different
 * rule with no shape or cap to restate, and scanning the whole file would
 * make this test responsible for unrelated code.
 *
 * **Proven red twice, by hand, before this file gated the build**: (1)
 * `WIDGET_SOURCE_SHAPES[widget.widgetType]` replaced with `["metric"]` —
 * reddened the "no restated shape literal" assertion; (2) the cap read
 * (`WIDGET_SOURCE_CARDINALITY[widget.widgetType].max`) replaced with the
 * literal `1` — reddened the "no restated cap number" assertion. Both
 * reverted before commit.
 */

/** Strips block and line comments before scanning — the repo idiom at
 * `tests/repo-invariants.test.ts:610-612` and `tests/f3.1d`'s own idiom — so a
 * docblock explaining the rule (which names "metric"/"dataset" in prose)
 * cannot trip the rule it explains. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * The block between the two declarations. Anchored on the full identifier
 * `export const sectionTemplateWidgetSchema` followed by a non-identifier
 * character, never a looser prefix — a looser
 * `/export const sectionTemplateWidget/` would match
 * `sectionTemplateWidgetIdentitySchema` first, one declaration up.
 */
function sourceRulesBlock(src: string): string {
  const startMatch = /export const sectionTemplateWidgetSchema\b/.exec(src);
  if (startMatch === null) {
    throw new Error("sectionTemplateWidgetSchema is not declared in the contract file");
  }
  const start = startMatch.index;
  const nextExport = /^export const /m.exec(src.slice(start + startMatch[0].length));
  const end = nextExport === null ? src.length : start + startMatch[0].length + nextExport.index;
  return src.slice(start, end);
}

describe("F3.61 Amendment 1: the template source rules read the shared records, never restate them", () => {
  it("anti-vacuity: the contract file reads non-empty and declares sectionTemplateWidgetSchema, in a non-trivial block", () => {
    const src = readFileSync(CONTRACT_PATH, "utf8");
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("sectionTemplateWidgetSchema");
    expect(sourceRulesBlock(src).length).toBeGreaterThan(200);
  });

  it("R4/R5/R7 read WIDGET_SOURCE_SHAPES, WIDGET_SOURCE_CARDINALITY and METRIC_CATALOG by lookup, and call the three shared message templates", () => {
    const src = readFileSync(CONTRACT_PATH, "utf8");
    const block = stripComments(sourceRulesBlock(src));

    expect(block).toContain("WIDGET_SOURCE_SHAPES[");
    expect(block).toContain("WIDGET_SOURCE_CARDINALITY[");
    expect(block).toContain("METRIC_CATALOG[");
    expect(block).toContain("bindingShapeMessage(");
    expect(block).toContain("columnNotDeclaredMessage(");
    expect(block).toContain("duplicateColumnMessage(");
  });

  it("no restated shape literal or cap number appears in the rules' code (comments stripped)", () => {
    const src = readFileSync(CONTRACT_PATH, "utf8");
    const block = stripComments(sourceRulesBlock(src));

    // Quoted literals only — the block's own `.describe()` prose contains the
    // bare word "dataset" and stripComments does not strip a string literal.
    const offenders: string[] = [];
    if (/"metric"/.test(block)) offenders.push('a restated "metric" literal');
    if (/"dataset"/.test(block)) offenders.push('a restated "dataset" literal');
    // A restated per-type cap, e.g. "at most 1" hand-written instead of read
    // from WIDGET_SOURCE_CARDINALITY[widgetType].max.
    if (/at most [0-9]/.test(block)) offenders.push("a restated numeric cap");

    expect(
      offenders,
      `${CONTRACT_FILE} must read WIDGET_SOURCE_SHAPES / WIDGET_SOURCE_CARDINALITY / ` +
        "METRIC_CATALOG rather than restate their contents. Fix the file named here.",
    ).toEqual([]);
  });
});
