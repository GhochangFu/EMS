import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Resolved through `createRequire` rather than a bare `import`, which is the
 * pattern `tests/ingest-contracts.test.ts:26-29` already documents for this
 * directory: **the `tests` project runs from the repo root, where the bundler
 * resolver has no workspace link to `@bms/shared`.** Node's own resolution
 * does. `typecheck:tests` runs `tsc --moduleResolution bundler`, so a static
 * import here typechecks green locally — where a hand-repaired
 * `node_modules/@bms/shared` symlink happens to exist — and fails CI's clean
 * install with `TS2307: Cannot find module '@bms/shared'`. It did exactly that
 * on PR #324.
 *
 * The types are declared locally for the same reason: a `import type` is still
 * a bundler-resolved specifier. They restate only the surface this file uses,
 * and `parseFormula`'s real signature is checked where it is defined.
 */
type CalcParseError = { code: string; position: number };
type ParseResult =
  | { ok: true; ast: unknown; refs: string[]; crossRefs: unknown[] }
  | { ok: false; errors: CalcParseError[] };

const require_ = createRequire(import.meta.url);
const calcDsl = require_("@bms/shared") as {
  CALC_DIALECT_V2: string;
  parseFormula: (expression: string, options?: { dialect?: string }) => ParseResult;
};
const { CALC_DIALECT_V2, parseFormula } = calcDsl;

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
 * - **(c) — no `z.literal(CALC_DIALECT)` anywhere under
 *   `packages/shared/src/contracts` or `apps/api/src`. No exemptions remain:
 *   Task 6 converted `asset-templates.schema.ts` and Task 7
 *   `asset-point-calc-override.schema.ts`.**
 * - **(d) — `calc-scope.service.ts`'s qualified-code statement contains a
 *   `location_id` filter**, checked against a mutated copy first — `Task 11`.
 *
 * Part (a) is **not yet in this file** — it lands with Task 12. Do not read
 * its absence as "done"; read it as "not this task's job."
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
 * **The scan now covers every file, and there is no exemption list.** Two files
 * were exempt while the guard changes that had to travel with their widening
 * were still unbuilt — `asset-templates.schema.ts` (`F2.9` Task 6) and
 * `asset-point-calc-override.schema.ts` (Task 7). The exemption was by filename
 * and **self-removing**: a companion test asserted each exempt file *still*
 * contained the literal, so converting one turned this file red and forced the
 * entry out rather than letting it rot into a permanent hole. Both have landed,
 * the list is empty, and it is not to be renewed. A new exemption is a scope
 * ruling, not a convenience.
 */
const DIALECT_LITERAL_RE = /z\.literal\(\s*CALC_DIALECT\s*\)/;

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

  it("no file pins a dialect field to bms-calc-v1", () => {
    const offenders = scannedFiles
      .map((file) => relative(file))
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

  /**
   * The two files that carried the exemption are the two the scan most has to
   * cover, and "no offenders" is also what an empty scan says. Named
   * explicitly, so a refactor that moves or renames either one is a failure
   * here rather than a silent hole.
   */
  it.each([
    "packages/shared/src/contracts/admin.ts",
    "apps/api/src/admin/asset-templates/asset-templates.schema.ts",
    "apps/api/src/admin/asset-points/asset-point-calc-override.schema.ts",
  ])("%s is in the scanned set and derives the dialect from CALC_DIALECTS", (rel) => {
    expect(scannedFiles.map((file) => relative(file)), `${rel} is not being scanned`).toContain(rel);
    const source = readFileSync(join(repoRoot, rel), "utf8");
    expect(DIALECT_LITERAL_RE.test(source), `${rel} restates the v1 literal`).toBe(false);
    expect(source, `${rel} must reach the vocabulary through calcDialectSchema`).toContain(
      "calcDialectSchema",
    );
  });
});

// --- part (d) — the qualified-code statement is contained by the owner's location ---

/**
 * ADR 0055 decision 12: `{CODE.key}` resolves against the **owner's**
 * `location_id`. `bms.assets.code` is globally unique, so a lookup by code
 * alone *succeeds* across locations and across organizations — the formula
 * silently reads another site's tag, and nothing throws. The integration
 * suite proves the containment on its own fixture, but a green suite cannot
 * see the filter go missing if every fixture happens to sit at one location.
 * This scan is the static guard for that: the `WHERE` of the qualified-code
 * statement in `calc-scope.service.ts` must name `location_id`.
 *
 * Verified against a mutated copy at the build gate (Task 11): with the
 * `WHERE a.location_id = r.location_id` line removed, "must have a WHERE
 * clause" fails; with the predicate replaced by `a.active`, "must filter on
 * location_id" fails. The in-file anti-vacuity case below re-runs the second
 * of those on every run.
 */
const CALC_SCOPE_SERVICE = "apps/api/src/calc/calc-scope.service.ts";

/**
 * The SQL template literal of `readQualifiedCodes` — the first `sql\`…\``
 * after the method's **definition**, not its call site, which is why the
 * marker carries `private async`. No backtick may appear inside the SQL, and
 * none does; a comment with one would end the literal early here as it would
 * in the compiler.
 */
function qualifiedCodeStatement(source: string): string | null {
  const definition = source.indexOf("private async readQualifiedCodes(");
  if (definition < 0) {
    return null;
  }
  const open = source.indexOf("sql`", definition);
  if (open < 0) {
    return null;
  }
  const close = source.indexOf("`", open + "sql`".length);
  if (close < 0) {
    return null;
  }
  return source.slice(open + "sql`".length, close);
}

/** Everything from the statement's first top-level `WHERE` to its end. */
function whereClause(statement: string): string | null {
  const match = /\bWHERE\b/.exec(statement);
  return match === null ? null : statement.slice(match.index);
}

/** Why `statement` fails the containment rule, or `null` when it holds. */
function containmentDefect(statement: string | null): string | null {
  if (statement === null) {
    return "the readQualifiedCodes statement could not be located";
  }
  if (!/\bbms\.assets\b/.test(statement) || !/\bcode\b/.test(statement)) {
    return "the located statement does not read bms.assets by code — the scan found the wrong literal";
  }
  const where = whereClause(statement);
  if (where === null) {
    return "the qualified-code statement must have a WHERE clause";
  }
  if (!/\blocation_id\b/.test(where)) {
    return "the qualified-code statement's WHERE must filter on location_id";
  }
  return null;
}

describe("ADR 0055 part (d) — the qualified-code statement filters on the owner's location_id", () => {
  const source = readFileSync(join(repoRoot, CALC_SCOPE_SERVICE), "utf8");

  it("locates the qualified-code statement, so the rule below is not silently vacuous", () => {
    const statement = qualifiedCodeStatement(source);
    expect(statement, `${CALC_SCOPE_SERVICE}: readQualifiedCodes and its sql template must exist`).not.toBeNull();
    expect(statement as string).toMatch(/\bbms\.assets\b/);
  });

  it("the statement's WHERE names location_id (ADR 0055 decision 12)", () => {
    const defect = containmentDefect(qualifiedCodeStatement(source));
    expect(
      defect,
      `${CALC_SCOPE_SERVICE}: ${defect ?? ""}\n\n` +
        "A {CODE.key} reference resolves only to an asset at the owner's location. " +
        "assets.code is globally unique, so a lookup without location_id succeeds across " +
        "sites and across organizations, and the formula silently reads another site's tag.",
    ).toBeNull();
  });

  /**
   * Anti-vacuity: the same analysis on the real source with the predicate
   * replaced must go red. Verified by hand at the build gate on a mutated copy
   * of the file; this case keeps that check alive on every run.
   */
  it("the analysis kills the mutation it exists to catch", () => {
    const statement = qualifiedCodeStatement(source) as string;
    const inverted = statement.replace(/WHERE[\s\S]*$/, "WHERE a.active");
    expect(inverted, "the mutation did not apply — the statement shape changed").not.toBe(statement);
    expect(containmentDefect(inverted)).toBe("the qualified-code statement's WHERE must filter on location_id");
    const dropped = statement.replace(/\s*WHERE[\s\S]*$/, "");
    expect(containmentDefect(dropped)).toBe("the qualified-code statement must have a WHERE clause");
  });
});
