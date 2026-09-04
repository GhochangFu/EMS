import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ParseResult } from "@bms/shared";
import { CALC_DIALECT_V2, parseFormula } from "@bms/shared";

/** The bare `tsc` invocation `typecheck:tests` runs over this directory has
 * no `--strict`, and without it this repo's toolchain does not narrow a
 * custom discriminated union on an `if (!result.ok)` check — confirmed with
 * a standalone repro at this task's build gate. An explicit `Extract` cast
 * sidesteps that quirk without weakening the runtime assertion. */
function asFailure(result: ParseResult): Extract<ParseResult, { ok: false }> {
  return result as Extract<ParseResult, { ok: false }>;
}
function asOk(result: ParseResult): Extract<ParseResult, { ok: true }> {
  return result as Extract<ParseResult, { ok: true }>;
}

/**
 * ADR 0055 (`bms-calc-v2`) invariants, `F2.9`. Four parts, filled in across
 * the plan's tasks — **only part (b) is built by Task 3**:
 *
 * - (a) — one builder, one topological sort (`buildCalcGraph`/
 *   `topologicalOrder` defined in exactly one file, imported by name from the
 *   three callers) — `Task 12`.
 * - **(b) — every `derived("…")` and `expression: "…"` literal under the
 *   stock catalog parses identically under both dialects.**
 * - (c) — no `z.literal(CALC_DIALECT)` anywhere under
 *   `packages/shared/src/contracts` or `apps/api/src` — `Task 5`.
 * - (d) — `calc-scope.service.ts`'s qualified-code statement contains a
 *   `location_id` filter, checked against a mutated copy first — `Task 11`.
 *
 * Parts (a), (c) and (d) are **not yet in this file** — they land with the
 * tasks named above. Do not read their absence as "done"; read it as "not
 * this task's job."
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stockCatalogDir = join(repoRoot, "apps", "api", "src", "admin", "asset-templates", "stock-catalog");

const stockCatalogFiles = readdirSync(stockCatalogDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(stockCatalogDir, name));

/** `\s` matches newlines too, so `derived(\n  "…"` (the multi-line call shape
 * a manual grep of a single-line pattern under-counts) is still found. */
const DERIVED_RE = /derived\(\s*"((?:[^"\\]|\\.)*)"/g;
/** `expression:\s*"…"` — deliberately requires the quote, so a type
 * annotation like `expression: string;` never matches. */
const EXPRESSION_RE = /expression:\s*"((?:[^"\\]|\\.)*)"/g;

function extractLiterals(source: string): string[] {
  const out: string[] = [];
  for (const re of [DERIVED_RE, EXPRESSION_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((match = re.exec(source))) {
      // The captured group is JS-string-literal content; JSON.parse decodes
      // its escapes (\", \\, …) the same way the source file's own compiler
      // would, without hand-rolling an unescaper.
      out.push(JSON.parse(`"${match[1]}"`) as string);
    }
  }
  return out;
}

const literalsByFile = stockCatalogFiles.map((file) => ({
  file,
  literals: extractLiterals(readFileSync(file, "utf8")),
}));

const allLiterals = literalsByFile.flatMap((entry) => entry.literals);

describe("ADR 0055 part (b) — every stock-catalog v1 formula literal parses identically under v2", () => {
  it("found stock-catalog files to scan, so the scan below is not silently empty", () => {
    expect(stockCatalogFiles.length).toBeGreaterThanOrEqual(30);
  });

  /**
   * Anti-vacuity: a scan regex that silently stops matching would let this
   * whole file pass while checking nothing — the exact failure this repo
   * keeps finding in review (see `tests/adr-0037-calc-engine-invariants.test.ts`
   * and its own anti-vacuity case). Verified by hand at the build gate: `36`
   * `derived("…")` calls (4 of them spanning the call across a line break)
   * plus `7` quoted `expression: "…"` KPI literals, `43` total, all under
   * this directory — counted with this file's own two regexes run standalone
   * against the raw source, not estimated from a looser grep (a bare
   * `derived\(` count also matches the helper's own declaration and doc
   * comments in `point-fields.ts`, which is why that looser count reads
   * higher and is not the right cross-check).
   */
  it("found at least 30 formula literals", () => {
    expect(allLiterals.length).toBeGreaterThanOrEqual(30);
  });

  it.each(literalsByFile.filter((entry) => entry.literals.length > 0))(
    "every literal in $file parses under bms-calc-v1",
    ({ file, literals }) => {
      for (const literal of literals) {
        const result = parseFormula(literal);
        if (!result.ok) {
          expect.fail(`${file}: ${JSON.stringify(literal)} must parse under v1 — got ${JSON.stringify(asFailure(result).errors)}`);
        }
      }
    },
  );

  it("every stock-catalog literal parses to the identical AST under v1 and v2 (ADR 0055 decision 4)", () => {
    for (const literal of allLiterals) {
      const v1 = parseFormula(literal);
      const v2 = parseFormula(literal, { dialect: CALC_DIALECT_V2 });
      expect(v1.ok, `${JSON.stringify(literal)} must parse under v1`).toBe(true);
      expect(v2.ok, `${JSON.stringify(literal)} must parse under v2`).toBe(true);
      if (v1.ok && v2.ok) {
        const v1Ok = asOk(v1);
        const v2Ok = asOk(v2);
        expect(JSON.stringify(v2Ok.ast), `AST mismatch for ${JSON.stringify(literal)}`).toBe(JSON.stringify(v1Ok.ast));
        expect(v2Ok.refs, `refs mismatch for ${JSON.stringify(literal)}`).toEqual(v1Ok.refs);
        expect(v2Ok.crossRefs, `a real stock literal must carry no crossRefs under v2: ${JSON.stringify(literal)}`).toEqual([]);
      }
    }
  });
});
