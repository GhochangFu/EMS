import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Resolved through `createRequire` rather than a bare `import`, for the exact
 * reason `tests/adr-0055-calc-v2-invariants.test.ts` gives at its own top: the
 * `tests` project runs from the repo root, where the bundler resolver has no
 * workspace link to `@bms/shared`, and a static import typechecks green
 * locally while failing CI's clean install (`TS2307`, PR #324). The types are
 * declared locally for the same reason.
 */
type CalcParseError = { code: string; position: number };
type ParseResult =
  | { ok: true; ast: unknown; refs: string[]; crossRefs: unknown[]; paramRefs: string[] }
  | { ok: false; errors: CalcParseError[] };

const require_ = createRequire(import.meta.url);
const calcDsl = require_("@bms/shared") as {
  CALC_DIALECTS: readonly string[];
  CALC_DIALECT_V2: string;
  CALC_DIALECT_V3: string;
  parseFormula: (expression: string, options?: { dialect?: string }) => ParseResult;
};
const { CALC_DIALECTS, CALC_DIALECT_V2, CALC_DIALECT_V3, parseFormula } = calcDsl;

function asFailure(result: ParseResult): Extract<ParseResult, { ok: false }> {
  return result as Extract<ParseResult, { ok: false }>;
}
function asOk(result: ParseResult): Extract<ParseResult, { ok: true }> {
  return result as Extract<ParseResult, { ok: true }>;
}

/**
 * ADR 0070 (`bms-calc-v3`) invariants, `E4.1a` U3. Three parts named in the
 * plan — **only (a) and (c) are built by U3**:
 *
 * - **(a) — every `derived("…")` / `expression: "…"` literal under the stock
 *   catalog parses to the identical AST under its own authored dialect and
 *   under `v3`.** The `v3` half of `adr-0055-calc-v2-invariants.test.ts` part
 *   (b)/(f)'s claim, restated for the third dialect rather than duplicated —
 *   the stock catalog ships no `v3` literal today, so "its own dialect" is
 *   `v1` or `v2` for every entry this file finds, and part (a) is exactly
 *   "the `(narrow, v3)` superset property, applied to real production text"
 *   rather than a new claim.
 * // part (b) lands in U7
 * - **(c) — `CALC_DIALECTS` has exactly three members, and `KPI_DIALECTS` in
 *   `asset-templates-content.schema.ts` is spread from it.**
 *
 * **The extractor below is a deliberate copy, not a shared import.** The
 * plan's preferred route was exporting `adr-0055-calc-v2-invariants.test.ts`'s
 * `extractLiterals` (and its two regexes) into a `tests/support/` module so
 * the two files cannot drift apart. That file is committed, outside this
 * unit's file set, and not queued for any other edit in this row's build
 * order — moving code out of it here would touch a file no plan task names.
 * The ADR 0055 build report already recorded this same tradeoff once
 * ("nothing forces a scan added to one file to be added to the other"); this
 * copy inherits it rather than resolving it, and a future unit that touches
 * both files is the right place to finish the extraction.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const stockCatalogDir = join(repoRoot, "apps", "api", "src", "admin", "asset-templates", "stock-catalog");

const stockCatalogFiles = readdirSync(stockCatalogDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => join(stockCatalogDir, name));

/** Copied from `adr-0055-calc-v2-invariants.test.ts` (see the module docblock
 * for why this is a copy and not a shared import). Unchanged: `\s` crosses a
 * line break, the option object is captured so a `v2`-authored literal is not
 * held to the `v1` parser, and there is no trailing `\)` anchor (four shipped
 * calls end `",\n)"`). */
const DERIVED_RE = /derived\(\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*(\{[^{}]*\}))?/g;
const V2_OPTION_RE = /formulaDialect:\s*CALC_DIALECT_V2/;
const EXPRESSION_RE = /expression:\s*"((?:[^"\\]|\\.)*)"/g;

type ScannedLiteral = { literal: string; dialect: string | undefined };

function extractLiterals(source: string): ScannedLiteral[] {
  const out: ScannedLiteral[] = [];
  const decode = (raw: string): string => JSON.parse(`"${raw}"`) as string;
  let match: RegExpExecArray | null;
  DERIVED_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = DERIVED_RE.exec(source))) {
    const options = match[2] ?? null;
    out.push({ literal: decode(match[1]), dialect: options !== null && V2_OPTION_RE.test(options) ? CALC_DIALECT_V2 : undefined });
  }
  EXPRESSION_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = EXPRESSION_RE.exec(source))) {
    out.push({ literal: decode(match[1]), dialect: undefined });
  }
  return out;
}

const allLiterals = stockCatalogFiles.flatMap((file) => extractLiterals(readFileSync(file, "utf8")));

describe("ADR 0070 part (a) — every stock-catalog formula literal parses identically under its own dialect and under bms-calc-v3", () => {
  it("found stock-catalog files to scan, so the scan below is not silently empty", () => {
    expect(stockCatalogFiles.length).toBeGreaterThanOrEqual(30);
  });

  /** Anti-vacuity floor, mirroring `adr-0055-calc-v2-invariants.test.ts`'s own
   * count (47 `v1`/undialected + 3 `v2` = 50 at that file's own gate). No
   * stock literal is authored `v3` today, so this file's total should track
   * that file's `allLiterals.length + v2Literals.length`. */
  it("found at least 30 formula literals", () => {
    expect(allLiterals.length).toBeGreaterThanOrEqual(30);
  });

  it("every literal parses to the identical AST under its own authored dialect and under bms-calc-v3", () => {
    for (const { literal, dialect } of allLiterals) {
      const own = parseFormula(literal, dialect === undefined ? undefined : { dialect });
      const v3 = parseFormula(literal, { dialect: CALC_DIALECT_V3 });
      if (!own.ok) {
        expect.fail(`${JSON.stringify(literal)} must parse under its own dialect (${dialect ?? "v1"}) — got ${JSON.stringify(asFailure(own).errors)}`);
      }
      if (!v3.ok) {
        expect.fail(`${JSON.stringify(literal)} must parse under v3 — got ${JSON.stringify(asFailure(v3).errors)}`);
      }
      const ownOk = asOk(own);
      const v3Ok = asOk(v3);
      expect(JSON.stringify(v3Ok.ast), `AST mismatch for ${JSON.stringify(literal)}`).toBe(JSON.stringify(ownOk.ast));
      expect(v3Ok.refs, `refs mismatch for ${JSON.stringify(literal)}`).toEqual(ownOk.refs);
      expect(v3Ok.crossRefs, `crossRefs mismatch for ${JSON.stringify(literal)}`).toEqual(ownOk.crossRefs);
      expect(v3Ok.paramRefs, `a real stock literal must carry no paramRefs under v3: ${JSON.stringify(literal)}`).toEqual([]);
    }
  });
});

// part (b) lands in U7

// --- part (c) — the dialect vocabulary has exactly three members, and KPI_DIALECTS derives from it ---

const ASSET_TEMPLATES_CONTENT_SCHEMA = "apps/api/src/admin/asset-templates/asset-templates-content.schema.ts";

describe("ADR 0070 part (c) — CALC_DIALECTS names all three dialects, and KPI_DIALECTS derives from it", () => {
  it("CALC_DIALECTS has exactly three members", () => {
    expect(CALC_DIALECTS).toHaveLength(3);
    expect(CALC_DIALECTS).toContain(CALC_DIALECT_V2);
    expect(CALC_DIALECTS).toContain(CALC_DIALECT_V3);
  });

  it("asset-templates-content.schema.ts spreads CALC_DIALECTS into KPI_DIALECTS", () => {
    const source = readFileSync(join(repoRoot, ASSET_TEMPLATES_CONTENT_SCHEMA), "utf8");
    expect(
      source.includes("...CALC_DIALECTS"),
      `${ASSET_TEMPLATES_CONTENT_SCHEMA} must spread CALC_DIALECTS into KPI_DIALECTS, so a v3 KPI dialect is accepted with no edit`,
    ).toBe(true);
  });
});
