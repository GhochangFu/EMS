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
 * - **(c) — no `z.literal(CALC_DIALECT)` under
 *   `packages/shared/src/contracts` or `apps/api/src`, except at the two sites
 *   Tasks 6 and 7 still own.**
 * - (d) — `calc-scope.service.ts`'s qualified-code statement contains a
 *   `location_id` filter, checked against a mutated copy first — `Task 11`.
 *
 * Parts (a) and (d) are **not yet in this file** — they land with the tasks
 * named above. Do not read their absence as "done"; read it as "not this
 * task's job."
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

// --- part (c) — the dialect vocabulary is declared once ----------------------

/**
 * `z.literal(CALC_DIALECT)` pins one endpoint to `bms-calc-v1` while every
 * other endpoint accepts `bms-calc-v2`. The failure is not a 500: the row
 * stores, and then one read or one write refuses it with a field error that
 * names a value the estate legitimately holds. That is the `F4.43` "nobody
 * restates a vocabulary" shape (`tests/f3.37-asset-role-vocabulary.test.ts`,
 * `tests/rule-vocabulary.test.ts`), in its source form: the vocabulary is
 * `CALC_DIALECTS`, and `calcDialectSchema` in
 * `packages/shared/src/contracts/admin.ts` is the one derivation of it.
 *
 * **One file is still exempt, and only until its own task lands.** `F2.9`
 * Task 7 owns `asset-point-calc-override.schema.ts`; widening it needs the
 * guard changes that come with it, so no earlier task may do it by hand. The
 * exemption is by filename and it is **self-removing**: the test below also
 * asserts each exempt file *still contains* the literal, so the day Task 7
 * lands this file goes red and the stale exemption has to be deleted rather
 * than left to rot into a permanent hole. That is what happened to
 * `asset-templates.schema.ts`'s entry, which Task 6 removed when it widened
 * that file to `calcDialectSchema` — the mechanism works, and the entry below
 * is not to be renewed once Task 7 is in.
 */
const DIALECT_LITERAL_RE = /z\.literal\(\s*CALC_DIALECT\s*\)/;

/** Owned by a later `F2.9` task; see the docblock above. Repo-relative. */
const DIALECT_LITERAL_EXEMPT = [
  "apps/api/src/admin/asset-points/asset-point-calc-override.schema.ts",
];

const SCANNED_ROOTS = ["packages/shared/src/contracts", "apps/api/src"];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Forward slashes, repo-relative — so the exemption list reads the same on
 * Windows and on CI's Linux runner. */
function relative(file: string): string {
  return file.slice(repoRoot.length).split("\\").join("/").replace(/^\/+/, "");
}

const scannedFiles = SCANNED_ROOTS.flatMap((root) => walkTsFiles(join(repoRoot, root)));

describe("ADR 0055 part (c) — no endpoint restates the calc dialect as a v1 literal", () => {
  it("scanned a real file set, so the scan below is not silently empty", () => {
    expect(scannedFiles.length).toBeGreaterThanOrEqual(200);
  });

  /** Anti-vacuity: a regex that stopped matching would let every assertion
   * below pass while checking nothing. Both the shape the repo actually wrote
   * and the whitespace variant a reformat could produce. */
  it("matches the pattern it is looking for", () => {
    expect(DIALECT_LITERAL_RE.test("  formulaDialect: z.literal(CALC_DIALECT).nullable(),")).toBe(true);
    expect(DIALECT_LITERAL_RE.test("z.literal( CALC_DIALECT )")).toBe(true);
    // and does not fire on the v2 constant, which is a different symbol
    expect(DIALECT_LITERAL_RE.test("z.literal(CALC_DIALECT_V2)")).toBe(false);
  });

  it("no file outside the two later-task sites pins a dialect field to bms-calc-v1", () => {
    const offenders = scannedFiles
      .map((file) => relative(file))
      .filter((rel) => !DIALECT_LITERAL_EXEMPT.includes(rel))
      .filter((rel) => DIALECT_LITERAL_RE.test(readFileSync(join(repoRoot, rel), "utf8")));

    expect(
      offenders,
      `these files spell z.literal(CALC_DIALECT) instead of deriving from CALC_DIALECTS:\n` +
        `${offenders.join("\n")}\n\n` +
        "Use `calcDialectSchema` from `packages/shared/src/contracts/admin.ts`. A literal here " +
        "refuses `bms-calc-v2` at one endpoint while every other endpoint accepts it, so the " +
        "same stored row reads back on one page and 400s on another (ADR 0055 decision 2).",
    ).toEqual([]);
  });

  it.each(DIALECT_LITERAL_EXEMPT)(
    "%s still carries the literal, so its exemption is still real",
    (rel) => {
      expect(
        DIALECT_LITERAL_RE.test(readFileSync(join(repoRoot, rel), "utf8")),
        `${rel} no longer spells z.literal(CALC_DIALECT). Its F2.9 task (7, for ` +
          "asset-point-calc-override.schema.ts) has landed — delete this file's entry from " +
          "DIALECT_LITERAL_EXEMPT so the scan covers it.",
      ).toBe(true);
    },
  );
});
