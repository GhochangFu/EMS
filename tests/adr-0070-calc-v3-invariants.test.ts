import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
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
  | { ok: true; ast: unknown; refs: string[]; crossRefs: unknown[]; paramRefs: string[]; windowReads: unknown[] }
  | { ok: false; errors: CalcParseError[] };

const require_ = createRequire(import.meta.url);
const calcDsl = require_("@bms/shared") as {
  CALC_DIALECTS: readonly string[];
  CALC_DIALECT_V2: string;
  CALC_DIALECT_V3: string;
  MAX_FORMULA_WINDOWS: number;
  parseFormula: (expression: string, options?: { dialect?: string }) => ParseResult;
};
const { CALC_DIALECTS, CALC_DIALECT_V2, CALC_DIALECT_V3, MAX_FORMULA_WINDOWS, parseFormula } = calcDsl;

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
 *   (b)/(f)'s claim, restated for the third dialect rather than duplicated.
 *   **Since `E4.1c` the catalog ships `v3` literals** (ADR 0070 decision 8):
 *   the extractor reads `formulaDialect: CALC_DIALECT_V3` as well as `V2`, a
 *   `v3`-authored literal is parsed under `v3` on both sides (the superset
 *   claim is trivially true of it; what (a) then holds is that it PARSES), and
 *   the "carries no `paramRefs`" claim applies to the non-`v3` literals only —
 *   a `$key` is `v3` syntax, so a `v1`/`v2` literal cannot carry one.
 * - **(a′) — the `v3` literals read only `0074`'s parameter vocabulary** (`E4.1c`
 *   U12): the twelve codes are parsed out of the migration's `INSERT`, never
 *   retyped; every `paramRefs` entry of every stock literal is one of them;
 *   every `v3` literal's `windowReads.length ≤ MAX_FORMULA_WINDOWS`; and an
 *   injected `{kw} * $not_a_key` in a temp copy is reported — the positive
 *   control that proves the membership check can fail.
 * - **(b) — no dialect gate outside the three grammar files compares to the
 *   `v2` literal** (U7). **(b′) — `E4.1b` U6 widens the same scan to the `v3`
 *   literal too**: a gate written `dialect === CALC_DIALECT_V3` is exactly as
 *   wrong as the `v2` version it was modelled on — it silently excludes
 *   whatever dialect comes after `v3` — so the regex and the allowlist are
 *   shared between both literals rather than duplicated into a second scan.
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
/** `E4.1c`: a `v3`-authored stock literal names the SYMBOL, like the `v2` rule. */
const V3_OPTION_RE = /formulaDialect:\s*CALC_DIALECT_V3/;
const EXPRESSION_RE = /expression:\s*"((?:[^"\\]|\\.)*)"/g;

type ScannedLiteral = { literal: string; dialect: string | undefined };

function dialectOf(options: string | null): string | undefined {
  if (options === null) return undefined;
  if (V3_OPTION_RE.test(options)) return CALC_DIALECT_V3;
  if (V2_OPTION_RE.test(options)) return CALC_DIALECT_V2;
  return undefined;
}

function extractLiterals(source: string): ScannedLiteral[] {
  const out: ScannedLiteral[] = [];
  const decode = (raw: string): string => JSON.parse(`"${raw}"`) as string;
  let match: RegExpExecArray | null;
  DERIVED_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = DERIVED_RE.exec(source))) {
    out.push({ literal: decode(match[1]), dialect: dialectOf(match[2] ?? null) });
  }
  EXPRESSION_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = EXPRESSION_RE.exec(source))) {
    out.push({ literal: decode(match[1]), dialect: undefined });
  }
  return out;
}

const allLiterals = stockCatalogFiles.flatMap((file) => extractLiterals(readFileSync(file, "utf8")));
const v3Literals = allLiterals.filter((entry) => entry.dialect === CALC_DIALECT_V3);

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

  /** Anti-vacuity for the `v3` arm: PR 2a authors 6 (feeder) + 1 + 5 + 4 + 1
   * (transformer, DG, solar, APFC) + 6 × 3 (water) = 35 `v3` stock literals;
   * PR 2b adds ten more. A `V3_OPTION_RE` that stopped matching would drop
   * them all into the `v1` set, where they fail to parse — loud either way,
   * but this floor names the cause. */
  it("found at least 35 v3-authored literals (E4.1c PR 2a)", () => {
    expect(v3Literals.length).toBeGreaterThanOrEqual(35);
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
      if (dialect !== CALC_DIALECT_V3) {
        expect(v3Ok.paramRefs, `a non-v3 stock literal must carry no paramRefs under v3: ${JSON.stringify(literal)}`).toEqual([]);
      }
    }
  });
});

// --- part (a′) — the v3 literals read only 0074's parameter vocabulary ---

/**
 * The twelve codes `0074_calc_parameters.sql` seeds into
 * `bms.calc_parameter_keys`, parsed out of the `INSERT … VALUES` block. The
 * vocabulary grows by `INSERT` (ADR 0070 decision 2), never by a release, so
 * a code a stock formula reads must already be one of these — otherwise every
 * tick refuses `parameter_unset` on a key no administrator can enter.
 */
const CALC_PARAMETERS_MIGRATION = join(repoRoot, "packages", "db", "drizzle", "0074_calc_parameters.sql");

function parameterKeysOf(migration: string): string[] {
  const start = migration.indexOf("INSERT INTO bms.calc_parameter_keys");
  const end = start < 0 ? -1 : migration.indexOf("ON CONFLICT", start);
  if (start < 0 || end < 0) return [];
  return [...migration.slice(start, end).matchAll(/'([a-z][a-z0-9_]{0,63})'/g)]
    .map((m) => m[1] as string)
    .filter((code, index, all) => all.indexOf(code) === index);
}

/**
 * The keys plan §3.7 reads — NINE distinct, not the "seven" plan §4 counts
 * (twelve less the three it names unread: `chemical_baseline_kg_per_day`,
 * `effluent_tariff_per_kl`, `tariff_pf_band`). PR 2b's packs read no `$key`,
 * so this is equality now and stays equality.
 */
const PARAMETER_KEYS_IN_USE = [
  "energy_tariff_per_kwh",
  "grid_carbon_factor_kgco2_per_kwh",
  "energy_baseline_kwh_per_day",
  "contract_demand_kva",
  "rated_kw",
  "tank_capacity_l",
  "installed_kwp",
  "water_tariff_per_kl",
  "water_baseline_kl_per_day",
] as const;

/** Every stock file's `paramRefs`, file by file, so an offender is named with its path. */
function paramRefViolations(files: readonly string[], vocabulary: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const file of files) {
    for (const { literal, dialect } of extractLiterals(readFileSync(file, "utf8"))) {
      const parsed = parseFormula(literal, { dialect: dialect ?? CALC_DIALECTS[0] });
      if (!parsed.ok) continue; // part (a) reports the parse failure
      for (const key of asOk(parsed).paramRefs) {
        if (!vocabulary.has(key)) out.push(`${file}: ${JSON.stringify(literal)} reads $${key}, not a 0074 parameter key`);
      }
    }
  }
  return out;
}

describe("ADR 0070 part (a′) — the v3 stock literals read only 0074's parameter vocabulary", () => {
  const vocabulary = new Set(parameterKeysOf(readFileSync(CALC_PARAMETERS_MIGRATION, "utf8")));

  it("parses exactly twelve parameter codes out of 0074's INSERT (anti-vacuity)", () => {
    expect([...vocabulary].sort()).toHaveLength(12);
  });

  it("every paramRefs entry of every stock literal is one of the twelve", () => {
    expect(paramRefViolations(stockCatalogFiles, vocabulary)).toEqual([]);
  });

  it("the keys in use are exactly the nine of plan §3.7 (the other three of the twelve are read by nothing)", () => {
    const inUse = new Set<string>();
    for (const { literal, dialect } of v3Literals) {
      const parsed = parseFormula(literal, { dialect });
      if (parsed.ok) for (const key of asOk(parsed).paramRefs) inUse.add(key);
    }
    expect([...inUse].sort()).toEqual([...PARAMETER_KEYS_IN_USE].sort());
  });

  it("every v3 literal's window reads fit MAX_FORMULA_WINDOWS", () => {
    for (const { literal, dialect } of v3Literals) {
      const parsed = parseFormula(literal, { dialect });
      expect(parsed.ok, `${JSON.stringify(literal)} must parse under v3`).toBe(true);
      if (parsed.ok) expect(asOk(parsed).windowReads.length, JSON.stringify(literal)).toBeLessThanOrEqual(MAX_FORMULA_WINDOWS);
    }
  });

  it("the positive control: an injected `{kw} * $not_a_key` literal in a temp copy is reported, naming the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "adr-0070-a-prime-"));
    try {
      const file = join(dir, "injected.ts");
      writeFileSync(
        file,
        'export const X = { ...derived("{kw} * $not_a_key", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }) };\n',
      );
      const violations = paramRefViolations([file], vocabulary);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("$not_a_key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- part (b) — no dialect gate outside the grammar compares to the v2 literal ---

/**
 * ADR 0070 decision 3 (plan design decision 14). Twenty-three sites measured
 * at the plan gate compared a dialect to `CALC_DIALECT_V2` with `===` or
 * `!==`, and every one of them silently excluded `v3` from the cross-asset
 * half it also carries — the override path's cycle check would skip a `v3`
 * formula's aggregates entirely. A gate asks `isCrossAssetDialect` /
 * `isParameterDialect` for the *capability*, never the version. The three
 * grammar files own the predicates and are the only permitted comparison
 * sites. Tests and specs are excluded: a fixture may name a dialect.
 *
 * **(b′), `E4.1b` U6:** the same defect can be written against `v3` instead —
 * `dialect === CALC_DIALECT_V3` silently excludes a future `v4` the way the
 * `v2` version excluded `v3` itself — so the regex below matches either
 * literal (`CALC_DIALECT_V(2|3)` / `"bms-calc-v(2|3)"`) rather than adding a
 * second, near-identical scan.
 */
const DIALECT_GATE_ROOTS = ["apps/api/src", "apps/web/src", "packages/db/src"];
const DIALECT_GATE_ALLOWLIST = new Set([
  "packages/shared/src/calc-dsl/limits.ts",
  "packages/shared/src/calc-dsl/tokenizer.ts",
  "packages/shared/src/calc-dsl/parser.ts",
]);
const V2_LITERAL_GATE =
  /[!=]==\s*(?:CALC_DIALECT_V[23]\b|"bms-calc-v[23]")|(?:\bCALC_DIALECT_V[23]\b|"bms-calc-v[23]")\s*[!=]==/;

function sourceFilesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) {
        out.push(path);
      }
    }
  };
  walk(join(repoRoot, root));
  return out;
}

function relativeTo(file: string): string {
  // A file outside the repository (the positive control writes its probe to a
  // temp dir) keeps its absolute path; slicing `repoRoot.length` off it yields
  // garbage — measured on CI, where /tmp is shorter than the checkout path.
  const normalised = file.replace(/\\/g, "/");
  const root = repoRoot.replace(/\\/g, "/");
  return normalised.startsWith(root) ? normalised.slice(root.length) : normalised;
}

function v2LiteralGates(files: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const relative = relativeTo(file);
    if (DIALECT_GATE_ALLOWLIST.has(relative)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (V2_LITERAL_GATE.test(line)) offenders.push(`${relative}:${index + 1}`);
    });
  }
  return offenders;
}

describe("ADR 0070 part (b)/(b′) — no dialect gate outside the grammar files compares to the v2 or v3 literal", () => {
  const files = DIALECT_GATE_ROOTS.flatMap(sourceFilesUnder);

  it("scans a real tree, so the rule below is not silently vacuous", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => relativeTo(f) === "apps/api/src/admin/asset-templates/asset-templates.schema.ts")).toBe(true);
  });

  it("the regex matches both operator orders and nothing else, for both v2 and v3", () => {
    expect(V2_LITERAL_GATE.test("  if (dialect === CALC_DIALECT_V2 && x) {")).toBe(true);
    expect(V2_LITERAL_GATE.test("  if (CALC_DIALECT_V2 !== row.dialect) {")).toBe(true);
    expect(V2_LITERAL_GATE.test('  if (dialect === "bms-calc-v2") {')).toBe(true);
    expect(V2_LITERAL_GATE.test("  if (dialect === CALC_DIALECT_V3 && x) {")).toBe(true);
    expect(V2_LITERAL_GATE.test("  if (CALC_DIALECT_V3 !== row.dialect) {")).toBe(true);
    expect(V2_LITERAL_GATE.test('  if (dialect === "bms-calc-v3") {')).toBe(true);
    expect(V2_LITERAL_GATE.test("  const label = DIALECT_LABELS[CALC_DIALECT_V2];")).toBe(false);
    expect(V2_LITERAL_GATE.test("  const label = DIALECT_LABELS[CALC_DIALECT_V3];")).toBe(false);
    expect(V2_LITERAL_GATE.test("  if (isCrossAssetDialect(dialect)) {")).toBe(false);
  });

  it("no source file outside limits/tokenizer/parser compares a dialect to CALC_DIALECT_V2 or CALC_DIALECT_V3", () => {
    expect(v2LiteralGates(files), "each site silently excludes the next dialect — use isCrossAssetDialect / isParameterDialect / isWindowDialect").toEqual(
      [],
    );
  });

  it("positive control: the scan reports an injected v2 gate", () => {
    // Written to a temp dir, never into the scanned tree: a killed run must
    // not leave a probe that fails the next `pnpm build`.
    const dir = mkdtempSync(join(tmpdir(), "adr0070-"));
    const injected = join(dir, "probe.ts");
    try {
      writeFileSync(injected, "export const x = (d: string) => d === CALC_DIALECT_V2;\n");
      const [offender] = v2LiteralGates([injected]);
      expect(offender, "the injected gate must be reported").toMatch(/probe\.ts:1$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("positive control: the scan reports an injected v3 gate (b′)", () => {
    // Proves the widened half of the regex actually fires, not just the v2
    // half it was copied from.
    const dir = mkdtempSync(join(tmpdir(), "adr0070-"));
    const injected = join(dir, "probe.ts");
    try {
      writeFileSync(injected, "export const x = (d: string) => d === CALC_DIALECT_V3;\n");
      const [offender] = v2LiteralGates([injected]);
      expect(offender, "the injected v3 gate must be reported").toMatch(/probe\.ts:1$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

// --- part (d) — the resolver statement is contained by the owner's organization, bounded by validity, and defaults nothing ---

/**
 * ADR 0070 decision 2, three properties of `calc-parameters.service.ts` that
 * the integration suite proves on its own fixture and a green suite cannot
 * see go missing if every fixture happens to sit in one organization:
 *
 * 1. **Containment** — the `WHERE` of the resolver statement names
 *    `organization_id`. The service is a fleet read (BYPASSRLS), so this
 *    predicate is the only thing stopping an organization-scope tariff in org
 *    A from serving an asset in org B.
 * 2. **Validity** — the same `WHERE` names both `effective_from` and
 *    `effective_to`; a resolver that dropped the end bound would keep serving
 *    a superseded tariff forever.
 * 3. **No default value anywhere** — the file contains no `COALESCE(` and no
 *    `?? 0` / `?? 1`. An unset key is absent from the map, and the host turns
 *    that into `parameter_unset`. A default here would be a wrong CO₂ figure
 *    on a board-level screen — the risk B14 named.
 *
 * Each rule carries a positive control on a mutated copy of the source, on
 * ADR 0055 part (d)'s shape: the analysis must kill the mutation.
 */
const CALC_PARAMETERS_SERVICE = "apps/api/src/calc/calc-parameters.service.ts";

/** The `sql\`…\`` template inside `resolveForAssets`, or `null` when the method or its template is not found. */
function resolverStatement(source: string): string | null {
  const start = source.indexOf("async resolveForAssets(");
  if (start === -1) return null;
  const open = source.indexOf("sql`", start);
  if (open === -1) return null;
  const close = source.indexOf("`", open + 4);
  if (close === -1) return null;
  return source.slice(open + 4, close);
}

function resolverDefect(statement: string | null): string | null {
  if (statement === null) return "resolveForAssets and its sql template must exist";
  const where = statement.slice(statement.indexOf("WHERE"));
  if (!statement.includes("WHERE")) return "the statement must have a WHERE clause";
  if (!/\borganization_id\b/.test(where)) return "the WHERE must name organization_id (containment)";
  if (!/\beffective_from\b/.test(where)) return "the WHERE must name effective_from";
  if (!/\beffective_to\b/.test(where)) return "the WHERE must name effective_to";
  return null;
}

function defaultValueDefect(source: string): string | null {
  if (/COALESCE\s*\(/i.test(source)) return "the file must not COALESCE a value — an unset key is absent, never defaulted";
  if (/\?\?\s*[01]\b/.test(source)) return "the file must not `?? 0` / `?? 1` a value — an unset key is absent, never defaulted";
  return null;
}

describe("ADR 0070 part (d) — the resolver statement is contained, bounded and default-free", () => {
  const source = readFileSync(join(repoRoot, CALC_PARAMETERS_SERVICE), "utf8");

  it("locates the resolver statement, so the rules below are not silently vacuous", () => {
    const statement = resolverStatement(source);
    expect(statement, `${CALC_PARAMETERS_SERVICE}: resolveForAssets and its sql template must exist`).not.toBeNull();
    expect(statement as string).toMatch(/\bbms\.calc_parameters\b/);
    expect(statement as string).toMatch(/\bbms\.assets\b/);
  });

  it("the WHERE names organization_id, effective_from and effective_to", () => {
    expect(resolverDefect(resolverStatement(source)), CALC_PARAMETERS_SERVICE).toBeNull();
  });

  it("positive control: the analysis kills each of the three mutations", () => {
    const statement = resolverStatement(source) as string;
    expect(resolverDefect(statement.replace("cp.organization_id = a.organization_id", "true"))).toMatch(/organization_id/);
    expect(resolverDefect(statement.replace("cp.effective_from <=", "true OR 1 <="))).toMatch(/effective_from/);
    expect(resolverDefect(statement.replace(/cp\.effective_to/g, "cp.ended"))).toMatch(/effective_to/);
  });

  it("the file defaults nothing: no COALESCE(, no ?? 0, no ?? 1", () => {
    expect(defaultValueDefect(source), CALC_PARAMETERS_SERVICE).toBeNull();
  });

  it("positive control: the default scan reports an injected COALESCE and an injected ?? 0", () => {
    expect(defaultValueDefect(`${source}\nconst x = COALESCE(cp.value, 0);`)).toMatch(/COALESCE/);
    expect(defaultValueDefect(`${source}\nconst y = map.get(k) ?? 0;`)).toMatch(/\?\? 0/);
  });
});

// --- part (e) — a window read never range-scans raw rows: the views serve every aggregate, and delta is two LIMIT 1 probes ---

/**
 * ADR 0070 decision 5 (`E4.1b` U8), a property of `calc-windows.service.ts`
 * the integration suite cannot prove by value: with every view running
 * `materialized_only = false`, a raw range scan answers the same number as
 * the composed read and only the cost differs. So the shape is scanned:
 *
 * 1. Every `FROM telemetry.` relation in the file is one of the four views,
 *    except **exactly two** occurrences of `FROM telemetry.point_values` —
 *    the first-sample and last-sample probes of `delta` — and each of those
 *    is followed within 200 characters (whitespace collapsed) by `LIMIT 1`.
 * 2. All four views are named (a level dropped from the ladder would be a
 *    silent cost regression the tiling property in `calc-window-plan.spec`
 *    cannot see, because the service, not the planner, names the relation).
 *
 * The docblock of the file spells the raw relation too, so the scan reads
 * the SQL template literals only — the text inside backtick strings passed
 * to `query(` — and never a comment.
 */
const CALC_WINDOWS_SERVICE = "apps/api/src/calc/calc-windows.service.ts";
const VIEW_RELATIONS = ["telemetry.point_values_1m", "telemetry.point_values_5m", "telemetry.point_values_1h", "telemetry.point_values_1d"];

/** The SQL template literals of the file: every backtick string that follows
 * `query(` / `query<...>(` (the pg pool) or `execute(sql` (Drizzle) — both
 * shapes the service uses, so a raw scan added on either is seen. */
function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  const re = /(?:query(?:<[^`]*?>)?\(\s*|execute(?:<[^`]*?>)?\(\s*sql)`([\s\S]*?)`/g;
  for (const m of source.matchAll(re)) {
    out.push(m[1]);
  }
  return out;
}

function rawScanDefect(templates: readonly string[]): string | null {
  // whitespace runs collapsed, so the 200-character budget measures SQL, not indentation
  const sql = templates.join("\n").replace(/\s+/g, " ");
  const rawSites = [...sql.matchAll(/FROM\s+telemetry\.point_values\b(?!_)/g)];
  if (rawSites.length !== 2) return `expected exactly two FROM telemetry.point_values sites (the two delta probes), found ${rawSites.length}`;
  for (const site of rawSites) {
    const tail = sql.slice(site.index as number, (site.index as number) + 200);
    if (!/LIMIT\s+1\b/.test(tail)) return "a FROM telemetry.point_values site is not followed by LIMIT 1 within 200 characters — a range scan";
  }
  const others = [...sql.matchAll(/FROM\s+(telemetry\.\w+)/g)].map((m) => m[1]).filter((r) => r !== "telemetry.point_values");
  for (const relation of others) {
    if (!VIEW_RELATIONS.includes(relation)) return `FROM ${relation} is neither a view nor a delta probe`;
  }
  return null;
}

describe("ADR 0070 part (e) — a window read never range-scans raw rows", () => {
  const source = readFileSync(join(repoRoot, CALC_WINDOWS_SERVICE), "utf8");
  const templates = sqlTemplates(source);

  it("found the service and its SQL templates, so the rules below are not silently vacuous", () => {
    expect(templates.length, `${CALC_WINDOWS_SERVICE}: expected at least four query( / execute(sql templates`).toBeGreaterThanOrEqual(4);
    expect(templates.join("\n")).toMatch(/FROM\s+telemetry\.point_values\b/);
    // the Drizzle shape is captured too: the calendar statement joins bms.locations
    expect(templates.some((t) => /JOIN\s+bms\.locations/.test(t)), "the execute(sql`…`) template is scanned").toBe(true);
  });

  it("names all four views — the level relation is interpolated from aggregateRelation, so the file names them through it", () => {
    // the per-level statement interpolates `${relation}`; the four names are
    // what `aggregateRelation` maps to, pinned in point-aggregates.ts
    const pointAggregates = readFileSync(join(repoRoot, "apps/api/src/telemetry/point-aggregates.ts"), "utf8");
    for (const relation of VIEW_RELATIONS) {
      expect(pointAggregates, relation).toContain(`"${relation}"`);
    }
    expect(source).toMatch(/aggregateRelation\(level\)/);
  });

  it("exactly two FROM telemetry.point_values sites, each a LIMIT 1 probe, and no other raw relation", () => {
    expect(rawScanDefect(templates), CALC_WINDOWS_SERVICE).toBeNull();
  });

  it("positive control: the scan reports an injected raw range scan and a dropped LIMIT", () => {
    expect(rawScanDefect([...templates, "SELECT sum(value) FROM telemetry.point_values v WHERE v.time >= $1 AND v.time < $2"])).toMatch(/exactly two/);
    const withoutLimit = templates.map((t) => t.replace(/ORDER BY v\.time ASC\s+LIMIT 1/, "ORDER BY v.time ASC"));
    expect(rawScanDefect(withoutLimit)).toMatch(/LIMIT 1/);
    expect(rawScanDefect([...templates, "SELECT 1 FROM telemetry.point_values_15m"])).toMatch(/neither a view/);
    // an injected raw range scan through the Drizzle shape is captured by sqlTemplates
    const injected = sqlTemplates(`${source}\nconst x = db.execute(sql\`SELECT sum(value) FROM telemetry.point_values v WHERE v.time >= \${a}\`);`);
    expect(injected.length).toBe(templates.length + 1);
    expect(rawScanDefect(injected)).toMatch(/exactly two/);
  });
});

// --- part (f) — the env var is read nowhere: neither the old name nor its ZAR-suffixed contract fields survive in code, compose, .env or the operational docs ---

/**
 * `E4.1c` U7, design decision 12–15/13. ADR 0070 decision 7 removes
 * `ENERGY_TARIFF_ZAR_PER_KWH`, `energyTariffZar()` and the `indicativeCostZar`
 * / `tariffZarPerKwh` contract field names.
 *
 * **The dispatch's regex, transcribed as `/ENERGY_TARIFF|energyTariffZar|
 * TariffZar|CostZar/`, cannot be built as given** — it is a plain substring
 * match, so `ENERGY_TARIFF` alone also matches `ENERGY_TARIFF_KEY`
 * (`energy-cost.ts`, the two `energy-cost.integration.spec.ts` files) and
 * `DEMO_ENERGY_TARIFF_KEY` (`calc-parameters-demo-seed.ts`) — the *replacement*
 * the plan mandates (U3, U5), not residue, and none of those files is on the
 * sweep list. The regex is narrowed to `/ENERGY_TARIFF_ZAR|[Tt]ariffZar|
 * [Cc]ostZar/`, which is what decision 7's own sentence actually names: the
 * env var is `ENERGY_TARIFF_ZAR_PER_KWH`, and the retired field names both
 * carry the `TariffZar` / `CostZar` stems. `/i` is not used — it would also
 * match the lowercase, legitimate `energy_tariff_per_kwh` parameter key
 * everywhere it appears — so `TariffZar`/`CostZar` are matched in either case
 * by an explicit `[Tt]`/`[Cc]` instead, which is also what proves the `.tsx`
 * positive control below (`tariffZarPerKwh`, lowercase-t) actually fires: the
 * literally-transcribed `TariffZar` (capital-T only) would have missed it.
 *
 * **Scan set**, per the dispatch: `apps/`, `packages/`, `scripts/` walked for
 * `.ts .tsx .js .mjs .cjs .yml .yaml .json .example` (skip `node_modules`,
 * `dist`, `coverage`, `.vite`), plus the repo-root `docker-compose*.yml` and
 * `.env*` files, `.github/workflows/*.yml`, and the three operational docs
 * `docs/env-inventory.md`, `docs/local-setup.md`, `docs/demo-script.md`.
 * Specs are included (a renamed fixture is exactly what part (f) must catch).
 *
 * **Exclusions the dispatch names are a scope statement, not a filter that
 * fires**: `docs/decisions.md` (a dated log entry, superseded-noted rather
 * than rewritten, in the sweep), this test file itself, and `docs/plans/`,
 * `docs/adr/`, `docs/BACKLOG.md` (records) are none of them under `apps/`,
 * `packages/`, `scripts/` or the three named docs paths above — the scan set
 * is an allowlist that never reaches them, so no `.filter()` line for them
 * would ever fire, and none is written.
 */
const ENERGY_TARIFF_TOKEN_RE = /ENERGY_TARIFF_ZAR|[Tt]ariffZar|[Cc]ostZar/;
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".yml", ".yaml", ".json", ".example"]);
const SCAN_SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".vite"]);

/** Every file under `root` whose extension is in {@link SCAN_EXTENSIONS}, skipping {@link SCAN_SKIP_DIRS}. */
function scanTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
        out.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

const ENV_VAR_SCAN_DOCS = ["docs/env-inventory.md", "docs/local-setup.md", "docs/demo-script.md"];

/** The dispatch's full scan set: `apps/`, `packages/`, `scripts/`, the root
 * `docker-compose*.yml` and `.env*` files, `.github/workflows/*.yml`, and the
 * three named operational docs. */
function envVarScanFiles(): string[] {
  const rootEntries = readdirSync(repoRoot, { withFileTypes: true }).filter((e) => e.isFile());
  const composeFiles = rootEntries.filter((e) => /^docker-compose.*\.yml$/.test(e.name)).map((e) => join(repoRoot, e.name));
  const dotEnvFiles = rootEntries.filter((e) => e.name.startsWith(".env")).map((e) => join(repoRoot, e.name));
  const workflowsDir = join(repoRoot, ".github", "workflows");
  const workflowFiles = readdirSync(workflowsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yml"))
    .map((e) => join(workflowsDir, e.name));
  return [
    ...scanTree(join(repoRoot, "apps")),
    ...scanTree(join(repoRoot, "packages")),
    ...scanTree(join(repoRoot, "scripts")),
    ...composeFiles,
    ...dotEnvFiles,
    ...workflowFiles,
    ...ENV_VAR_SCAN_DOCS.map((p) => join(repoRoot, p)),
  ];
}

/** `file:line` for every line in `files` matching {@link ENERGY_TARIFF_TOKEN_RE}. */
function envVarTokenHits(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const file of files) {
    const relative = relativeTo(file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (ENERGY_TARIFF_TOKEN_RE.test(line)) out.push(`${relative}:${index + 1}`);
    });
  }
  return out;
}

describe("ADR 0070 part (f) — the env var is read nowhere", () => {
  const files = envVarScanFiles();

  it("scans at least 400 files, so the rule below is not silently vacuous", () => {
    expect(files.length).toBeGreaterThanOrEqual(400);
    const relatives = files.map(relativeTo);
    expect(relatives).toContain("apps/web/src/pages/energy-page.tsx");
    expect(relatives).toContain("docker-compose.yml");
  });

  it("positive control: the scan reports an injected .ts env-var read", () => {
    const dir = mkdtempSync(join(tmpdir(), "adr0070f-"));
    try {
      const injected = join(dir, "probe.ts");
      writeFileSync(injected, "const zar = process.env.ENERGY_TARIFF_ZAR_PER_KWH;\n");
      expect(envVarTokenHits(scanTree(dir))).toEqual([expect.stringMatching(/probe\.ts:1$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("positive control: the scan reports an injected .tsx field name — proves the extension list, and the case fix", () => {
    const dir = mkdtempSync(join(tmpdir(), "adr0070f-"));
    try {
      const injected = join(dir, "probe.tsx");
      writeFileSync(injected, "export const tariffZarPerKwh = data.tariffZarPerKwh;\n");
      expect(envVarTokenHits(scanTree(dir))).toEqual([expect.stringMatching(/probe\.tsx:1$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("positive control: the scan reports an injected .yml compose default", () => {
    const dir = mkdtempSync(join(tmpdir(), "adr0070f-"));
    try {
      const injected = join(dir, "probe.yml");
      writeFileSync(injected, "      ENERGY_TARIFF_ZAR_PER_KWH: 2.15\n");
      expect(envVarTokenHits(scanTree(dir))).toEqual([expect.stringMatching(/probe\.yml:1$/)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no scanned file names the old env var or the retired ZAR-suffixed contract field names", () => {
    expect(
      envVarTokenHits(files),
      "docker-compose.yml, apps/api/.env.example, docs/env-inventory.md, docs/local-setup.md and docs/demo-script.md must drop every ENERGY_TARIFF_ZAR_PER_KWH / TariffZar / CostZar line",
    ).toEqual([]);
  });
});

describe("ADR 0070 part (f), structural half — dashboard.service.ts and reports.service.ts read the environment nowhere", () => {
  const STRUCTURAL_FILES = ["apps/api/src/dashboard/dashboard.service.ts", "apps/api/src/reports/reports.service.ts"];

  function residueDefect(source: string): string | null {
    if (/process\.env/.test(source)) return "the file must not read process.env — the tariff comes from CalcParametersService";
    if (/\b2\.15\b/.test(source)) return "the file must not carry the literal 2.15 default";
    return null;
  }

  it("neither service reads process.env nor carries the literal 2.15 default", () => {
    for (const file of STRUCTURAL_FILES) {
      const source = readFileSync(join(repoRoot, file), "utf8");
      expect(residueDefect(source), file).toBeNull();
    }
  });

  it("positive control: the scan reports an injected process.env read and an injected 2.15 literal", () => {
    const source = readFileSync(join(repoRoot, STRUCTURAL_FILES[0]!), "utf8");
    expect(residueDefect(`${source}\nconst x = process.env.SOMETHING;`)).toMatch(/process\.env/);
    expect(residueDefect(`${source}\nconst y = 2.15;`)).toMatch(/2\.15/);
  });
});

// --- part (g) — no default value in the cost helper ---

/**
 * `E4.1c` U7, design decision 13/2. `energy-cost.ts` must default nothing —
 * an unresolved tariff or currency is absent, never `0`/`1`, per
 * {@link energyCost}'s own docblock.
 *
 * **A sibling of part (d)'s `defaultValueDefect`, not a reuse.** The plain
 * helper is the right analysis for `calc-parameters.service.ts`, which never
 * spells `COALESCE(` in prose — but `energy-cost.ts`'s own docblock *does*,
 * on purpose (`"tests/adr-0070 part (g) scans this file for COALESCE(, ?? 0
 * and ?? 1"`), so the plain helper false-positives on its own gate
 * description: the exact "a text scan reads docblock prose too" shape, this
 * time inside the file the scan itself is pointed at rather than a fixture.
 * `energy-cost.ts` is `U3`'s, already committed and correct prose — it is not
 * this unit's to edit — so the fix lives here: comments are stripped before
 * the code is scanned. (Known limitation, unexercised by this file: a `//`
 * inside a string or SQL template would be stripped as if it started a
 * comment; `energy-cost.ts` carries none — confirmed by inspection.) `part
 * (d)`'s own gate is untouched by this file — its `defaultValueDefect` is not
 * modified, so `calc-parameters.service.ts`'s behaviour cannot regress.
 */
const ENERGY_COST_FILE = "apps/api/src/telemetry/energy-cost.ts";

/** Strips `/* … *\/` and `// …` before scanning, so a comment describing the
 * gate cannot trip it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function costHelperDefaultValueDefect(source: string): string | null {
  return defaultValueDefect(stripComments(source));
}

describe("ADR 0070 part (g) — the cost helper defaults nothing", () => {
  const source = readFileSync(join(repoRoot, ENERGY_COST_FILE), "utf8");

  it("the file's docblock spells COALESCE( in prose, so the plain part (d) helper is not vacuously safe to reuse here", () => {
    expect(defaultValueDefect(source)).not.toBeNull();
  });

  it("the code (comments stripped) contains no COALESCE(, no ?? 0, no ?? 1", () => {
    expect(costHelperDefaultValueDefect(source), ENERGY_COST_FILE).toBeNull();
  });

  it("positive control: the scan reports an injected COALESCE and an injected ?? 0 and ?? 1 in real code", () => {
    expect(costHelperDefaultValueDefect(`${source}\nconst x = COALESCE(row.value, 0);`)).toMatch(/COALESCE/);
    expect(costHelperDefaultValueDefect(`${source}\nconst y = tariffs.get(id) ?? 0;`)).toMatch(/\?\? 0/);
    expect(costHelperDefaultValueDefect(`${source}\nconst z = tariffs.get(id) ?? 1;`)).toMatch(/\?\? 1/);
  });

  it("negative control: a comment naming COALESCE( is not reported, so the stripper is what is doing the work", () => {
    expect(costHelperDefaultValueDefect(`${source}\n// COALESCE( in a comment, not code\n`)).toBeNull();
    expect(costHelperDefaultValueDefect(`${source}\n/* COALESCE( in a block comment */\n`)).toBeNull();
  });
});
