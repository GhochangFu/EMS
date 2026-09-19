import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** The SQL template literals of the file: every backtick string that follows `query(` or `query<...>(`. */
function sqlTemplates(source: string): string[] {
  const out: string[] = [];
  const re = /query(?:<[^`]*?>)?\(\s*`([\s\S]*?)`/g;
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
    expect(templates.length, `${CALC_WINDOWS_SERVICE}: expected at least three query( templates`).toBeGreaterThanOrEqual(3);
    expect(templates.join("\n")).toMatch(/FROM\s+telemetry\.point_values\b/);
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
  });
});
