import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** Comments stripped: a docblock that spells the expression must not satisfy the scan. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * `F4.303` U10 (ADR 0108 Amendment 6 item 6; plan C12) — `reportTemplateIdSchema` is the enum of
 * the two templates' own `id` literals, read through `.shape.id.value`, never restated as
 * string literals (§4.8). The runtime claim (`options` is exactly the two ids) is
 * `trend-points-report.spec.ts` R1; this is the source claim that no one retyped them.
 */
describe("F4.303 U10 — the report template id enum is derived", () => {
  it("builds reportTemplateIdSchema from the two templates' id literals", () => {
    const code = codeOnly(read("packages/shared/src/contracts/reports.ts"));
    expect(code).toMatch(
      /reportTemplateIdSchema\s*=\s*z\.enum\(\[\s*energyReportTemplateSchema\.shape\.id\.value,\s*trendPointsReportTemplateSchema\.shape\.id\.value,?\s*\]\)/,
    );
  });

  it("does not restate either id as a string literal inside the enum expression", () => {
    const code = codeOnly(read("packages/shared/src/contracts/reports.ts"));
    const enumExpression = /reportTemplateIdSchema\s*=\s*z\.enum\(\[[\s\S]*?\]\)/.exec(code)?.[0] ?? "";
    expect(enumExpression, "the enum expression was not found").not.toBe("");
    expect(enumExpression).not.toMatch(/["'](energy_consumption|trend_points)["']/);
  });
});
