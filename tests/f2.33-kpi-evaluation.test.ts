import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `F2.33` (ADR 0097) — two source facts no behavioural spec can see.
 *
 * 1. **The KPIs tab no longer says that no KPI computes** (ADR 0097
 *    Consequences: "The F2.22 start-gate ruling is reversed"). The sentence
 *    is a docblock, so nothing on screen changes and the browser cannot hold
 *    it; this scan is its gate.
 * 2. **One composition, two hosts** (decision 5). The scheduler and the KPI
 *    read host both import `assembleInputs` from `calc-input-assembly`, and
 *    the KPI host never reads samples itself — a second copy of the
 *    composition would drift from the scheduler's without any test seeing it.
 */

const KPIS_TAB = "apps/web/src/components/asset-templates/kpis-tab.tsx";
const SCHEDULER = "apps/api/src/calc/calc-scheduler.service.ts";
const KPI_HOST = "apps/api/src/assets/asset-kpis.service.ts";

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

/** An import line naming `assembleInputs` from `calc-input-assembly`, single- or multi-line. */
const IMPORTS_ASSEMBLE_INPUTS = /^import\s*\{[^}]*\bassembleInputs\b[^}]*\}\s*from\s*["'][./]*(?:calc\/)?calc-input-assembly["'];?$/m;

/** Non-comment lines that call a sample read directly. */
function directSampleReads(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .filter((line) => /\.getLatestSamples(ForPairs)?\(/.test(line));
}

/** Docblock prose with its line breaks and leading ` * ` folded to single spaces, so a sentence
 * wrapped across two comment lines is still one string. */
function prose(source: string): string {
  return source.replace(/\s*\n\s*\*?\s*/g, " ");
}

describe("F2.33 (1) — the KPIs tab docblock says a KPI computes at read time", () => {
  const source = prose(read(KPIS_TAB));

  it("folds a wrapped sentence into one string (positive control)", () => {
    expect(prose("No KPI is\n * evaluated anywhere yet")).toContain("No KPI is evaluated anywhere yet");
  });

  it("still names F2.33 (the scan reads the right file)", () => {
    expect(source).toContain("F2.33");
  });

  it("no longer says no KPI is evaluated anywhere", () => {
    expect(source).not.toContain("No KPI is evaluated anywhere yet");
  });

  it("says a KPI computes at read time on the asset page", () => {
    expect(source).toContain("read time");
    expect(source).toContain("asset page");
  });
});

describe("F2.33 (2) — the scheduler and the KPI host share one input assembly", () => {
  it.each([SCHEDULER, KPI_HOST])("%s imports assembleInputs from calc-input-assembly", (rel) => {
    expect(IMPORTS_ASSEMBLE_INPUTS.test(read(rel)), `${rel} must import assembleInputs from calc-input-assembly`).toBe(true);
  });

  it("the KPI host reads no sample itself", () => {
    expect(
      directSampleReads(read(KPI_HOST)),
      "the KPI host must read samples only through assembleInputs (ADR 0097 decision 5)",
    ).toEqual([]);
  });

  it("the scan reports an injected direct read (positive control)", () => {
    const mutated = `${read(KPI_HOST)}\n  await deps.inputs.getLatestSamplesForPairs(pairs);\n`;
    expect(directSampleReads(mutated)).toHaveLength(1);
  });

  it("the import pattern refuses an import from another module (positive control)", () => {
    expect(IMPORTS_ASSEMBLE_INPUTS.test('import { assembleInputs } from "./calc-input-assembly-copy";')).toBe(false);
    expect(IMPORTS_ASSEMBLE_INPUTS.test('import { assembleInputs } from "./calc-input-assembly";')).toBe(true);
  });
});
