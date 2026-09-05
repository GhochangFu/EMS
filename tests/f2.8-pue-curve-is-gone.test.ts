import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Resolved through `createRequire` rather than a bare `import` —
 * `tests/adr-0055-calc-v2-invariants.test.ts:1-20` documents why: the `tests`
 * project runs from the repo root, where the bundler resolver has no
 * workspace link to `@bms/shared`. Node's own resolution does. A static
 * import here typechecks green locally, on a hand-repaired
 * `node_modules/@bms/shared` symlink, and fails CI's clean install with
 * `TS2307: Cannot find module '@bms/shared'`.
 */
type CalcParseError = { code: string; position: number };
/** The AST node shape `crossRefKey` consumes — restated locally per this
 * directory's `createRequire` convention; the real type lives in
 * `packages/shared/src/calc-dsl/ast.ts`. */
type CalcCrossRefNode = { readonly kind: string };
type ParseResult =
  | { ok: true; ast: unknown; refs: string[]; crossRefs: CalcCrossRefNode[] }
  | { ok: false; errors: CalcParseError[] };

const require_ = createRequire(import.meta.url);
const calcDsl = require_("@bms/shared") as {
  CALC_DIALECT_V2: string;
  parseFormula: (expression: string, options?: { dialect?: string }) => ParseResult;
  crossRefKey: (node: CalcCrossRefNode) => string;
};
const { CALC_DIALECT_V2, parseFormula, crossRefKey } = calcDsl;

function asOk(result: ParseResult): Extract<ParseResult, { ok: true }> {
  return result as Extract<ParseResult, { ok: true }>;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// --- part (a) — the fitted PUE curve is gone -------------------------------

/**
 * `F2.8` ruling 4: the fitted curve `1.22 + Math.min(0.45, totalKw / 12_000)`
 * and its three `estimatePue` methods (`dashboard.service.ts`,
 * `reports.service.ts`, `apps/web/src/lib/pue-estimate.ts`, deleted by
 * Task 5/4) must not exist anywhere under `apps/api/src` or `apps/web/src`.
 * `node_modules` and `dist` are skipped — neither is source, and a `dist`
 * build can still carry a stale compiled copy for a while.
 */
const SCAN_ROOTS = ["apps/api/src", "apps/web/src"];
const THIS_FILE = fileURLToPath(import.meta.url);

/**
 * The fixture the anti-vacuity case proves the regex bites on — the exact
 * literal `git show 58d7019:apps/api/src/dashboard/dashboard.service.ts`
 * carried before Task 5 deleted it. Built from parts so the string
 * `"1.22" + " + "` does not itself appear in this file's source as a
 * contiguous `1.22 + ` — which the scan below would otherwise flag, since the
 * scan excludes this file by path rather than by content.
 */
const CURVE_FIXTURE = ["1.22", " + ", "Math.min(0.45, totalKw / 12_000)"].join("");

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

const scannedFiles = SCAN_ROOTS.flatMap((root) => walkTsFiles(join(repoRoot, root))).filter(
  (file) => file !== THIS_FILE,
);

const CURVE_RE = /1\.22 \+ /;
const ESTIMATE_PUE_RE = /estimatePue/;

describe("F2.8 part (a) — the fitted PUE curve is gone from apps/api and apps/web", () => {
  it("scanned a real file set, so the scan below is not silently empty", () => {
    expect(scannedFiles.length).toBeGreaterThanOrEqual(300);
  });

  it("the curve regex matches the pre-Task-5 fixture, so a miss below is not vacuous", () => {
    expect(CURVE_RE.test(CURVE_FIXTURE)).toBe(true);
    expect(ESTIMATE_PUE_RE.test("  private estimatePue(totalKw: number): number {")).toBe(true);
  });

  it("no source file under apps/api/src or apps/web/src calls estimatePue or spells the fitted curve", () => {
    const offenders = scannedFiles
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
      .filter(({ source }) => ESTIMATE_PUE_RE.test(source) || CURVE_RE.test(source))
      .map(({ file }) => file.slice(repoRoot.length).split("\\").join("/").replace(/^\/+/, ""));

    expect(
      offenders,
      `these files still carry estimatePue or the fitted curve, which F2.8 ruling 4 deletes:\n${offenders.join("\n")}\n\n` +
        "PUE is now Sigma site_kw / Sigma it_kw over the incomers in scope, or null (Task 5) — no fallback, no 1.0 sentinel.",
    ).toEqual([]);
  });
});

// --- part (b) — electrical-feeder.ts carries the three v2 points ----------

/**
 * `F2.8` Task 2, plan §5 Task 6 correction: `crossRefKey` prefixes every key
 * with its node kind (`packages/shared/src/calc-dsl/cross-ref.ts:11-45`), so
 * an aggregate's key reads `a:sum(kw)@site` / `a:sum(kw)@group:IT_LOAD`, not
 * the bare `sum(kw)@site` an earlier draft of this docblock might suggest.
 * Hand-written here, and only here, because pinning `crossRefKey`'s output
 * shape is the point of this part.
 */
const FEEDER_FILE = join(
  repoRoot,
  "apps",
  "api",
  "src",
  "admin",
  "asset-templates",
  "stock-catalog",
  "electrical-feeder.ts",
);

const FEEDER_DERIVED_RE = /derived\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\{[^{}]*\})\)/g;
const POINT_KEY_AFTER_RE = /pointKey:\s*"([a-z_]+)"/;

type FeederDerivedCall = { literal: string; options: string; pointKeyAfter: string | null };

function extractFeederDerivedCalls(source: string): FeederDerivedCall[] {
  const out: FeederDerivedCall[] = [];
  const decode = (raw: string): string => JSON.parse(`"${raw}"`) as string;
  let match: RegExpExecArray | null;
  FEEDER_DERIVED_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((match = FEEDER_DERIVED_RE.exec(source))) {
    const tailStart = FEEDER_DERIVED_RE.lastIndex;
    const tail = source.slice(tailStart, tailStart + 400);
    const pointKeyMatch = POINT_KEY_AFTER_RE.exec(tail);
    out.push({
      literal: decode(match[1]),
      options: match[2],
      pointKeyAfter: pointKeyMatch ? pointKeyMatch[1] : null,
    });
  }
  return out;
}

/**
 * Runs `extractFeederDerivedCalls` and `checkStockVersion2` against `source`,
 * returning the list of assertion failures rather than throwing — so both the
 * real file and a mutated scratch copy can be driven through one function,
 * and the red-run proof (Task 6's gate requirement) is one call rather than a
 * hand-duplicated assertion block.
 */
function feederDefects(source: string): string[] {
  const defects: string[] = [];
  const calls = extractFeederDerivedCalls(source);
  if (calls.length !== 3) {
    defects.push(`expected exactly 3 derived() calls, found ${calls.length}`);
  }
  const expectedKeys = ["site_kw", "it_kw", "pue"];
  calls.forEach((call, index) => {
    const expectedKey = expectedKeys[index];
    if (call.pointKeyAfter !== expectedKey) {
      defects.push(
        `derived() call ${index} (${JSON.stringify(call.literal)}) is followed by pointKey ${JSON.stringify(call.pointKeyAfter)}, expected ${JSON.stringify(expectedKey)}`,
      );
    }
    if (!/formulaDialect:\s*CALC_DIALECT_V2/.test(call.options)) {
      defects.push(`derived() call ${index} is missing formulaDialect: CALC_DIALECT_V2 in its options`);
    }
    if (!/calcTrigger:\s*"scheduled"/.test(call.options)) {
      defects.push(`derived() call ${index} is missing calcTrigger: "scheduled" in its options`);
    }
  });
  if (!/stockVersion:\s*2\b/.test(source)) {
    defects.push("stockVersion is not 2");
  }
  return defects;
}

describe("F2.8 part (b) — electrical-feeder.ts authors the three v2 points on the incomer", () => {
  const source = readFileSync(FEEDER_FILE, "utf8");
  const calls = extractFeederDerivedCalls(source);

  it("found the three derived() calls, so the scan below is not silently empty", () => {
    expect(calls.length).toBe(3);
  });

  it("the real file has no defects", () => {
    expect(feederDefects(source)).toEqual([]);
  });

  it("the analysis kills a mutation: stockVersion 1 or a missing derived() call", () => {
    const stockVersion1 = source.replace(/stockVersion:\s*2/, "stockVersion: 1");
    expect(stockVersion1, "the mutation did not apply").not.toBe(source);
    expect(feederDefects(stockVersion1)).toContain("stockVersion is not 2");

    // Remove the `pue` derived() call entirely (its whole object literal).
    const puePattern =
      /\s*\{\s*\.\.\.derived\("\{site_kw\} \/ \{it_kw\}"[\s\S]*?\},\n/;
    const removed = source.replace(puePattern, "\n");
    expect(removed, "the mutation did not apply — the pue block shape changed").not.toBe(source);
    expect(feederDefects(removed)).toContain("expected exactly 3 derived() calls, found 2");
  });

  it("each literal parses under bms-calc-v2 with the expected refs / crossRefs (crossRefKey's kind-prefixed shape)", () => {
    const [siteKw, itKw, pue] = calls;

    const siteKwResult = parseFormula(siteKw.literal, { dialect: CALC_DIALECT_V2 });
    expect(siteKwResult.ok, `${siteKw.literal} must parse under v2`).toBe(true);
    if (siteKwResult.ok) {
      const ok = asOk(siteKwResult);
      expect(ok.refs).toEqual([]);
      expect(ok.crossRefs.map((ref) => crossRefKey(ref))).toEqual(["a:sum(kw)@site"]);
    }

    const itKwResult = parseFormula(itKw.literal, { dialect: CALC_DIALECT_V2 });
    expect(itKwResult.ok, `${itKw.literal} must parse under v2`).toBe(true);
    if (itKwResult.ok) {
      const ok = asOk(itKwResult);
      expect(ok.refs).toEqual([]);
      expect(ok.crossRefs.map((ref) => crossRefKey(ref))).toEqual(["a:sum(kw)@group:IT_LOAD"]);
    }

    const pueResult = parseFormula(pue.literal, { dialect: CALC_DIALECT_V2 });
    expect(pueResult.ok, `${pue.literal} must parse under v2`).toBe(true);
    if (pueResult.ok) {
      const ok = asOk(pueResult);
      expect(ok.refs).toEqual(["site_kw", "it_kw"]);
      expect(ok.crossRefs).toEqual([]);
    }
  });
});

// --- part (c) — the demo seed's it_kw diverges from the stock literal, and only it_kw ---

/**
 * `packages/db/src/pue-demo-seed.ts` §3.1: `site_kw` and `pue` are byte
 * identical to the stock `electrical-feeder` literals; `it_kw` reads
 * `{rack_kw}` instead of `{kw}` because the simulator's IT assets emit
 * `rack_kw`, never `kw`. Read as text via the exported `PUE_DEMO_FORMULAS`
 * constant, the shape `pue-demo-seed.ts` itself documents (module docblock,
 * "exported constants").
 */
const PUE_DEMO_SEED_FILE = join(repoRoot, "packages", "db", "src", "pue-demo-seed.ts");

const FORMULA_CONST_RE = /^\s*(site_kw|it_kw|pue):\s*"((?:[^"\\]|\\.)*)",?\s*$/m;

function extractDemoFormula(source: string, key: "site_kw" | "it_kw" | "pue"): string | null {
  const re = new RegExp(`^\\s*${key}:\\s*"((?:[^"\\\\]|\\\\.)*)",?\\s*$`, "m");
  const match = re.exec(source);
  return match ? (JSON.parse(`"${match[1]}"`) as string) : null;
}

describe("F2.8 part (c) — pue-demo-seed.ts diverges from the stock feeder in it_kw alone", () => {
  const demoSource = readFileSync(PUE_DEMO_SEED_FILE, "utf8");
  const stockSource = readFileSync(FEEDER_FILE, "utf8");
  const stockCalls = extractFeederDerivedCalls(stockSource);
  const stockByKey = new Map(
    stockCalls.map((call, index) => [["site_kw", "it_kw", "pue"][index], call.literal] as const),
  );

  it("matches the formula constant pattern, so the extraction below is not silently vacuous", () => {
    expect(FORMULA_CONST_RE.test('  site_kw: "sum({kw} @site)",')).toBe(true);
  });

  it("found all three demo formulas as text", () => {
    expect(extractDemoFormula(demoSource, "site_kw")).not.toBeNull();
    expect(extractDemoFormula(demoSource, "it_kw")).not.toBeNull();
    expect(extractDemoFormula(demoSource, "pue")).not.toBeNull();
  });

  it("the demo it_kw formula reads sum({rack_kw} @group('IT_LOAD'))", () => {
    expect(extractDemoFormula(demoSource, "it_kw")).toBe("sum({rack_kw} @group('IT_LOAD'))");
  });

  it("site_kw and pue are byte-identical between the demo seed and the stock feeder", () => {
    expect(extractDemoFormula(demoSource, "site_kw")).toBe(stockByKey.get("site_kw"));
    expect(extractDemoFormula(demoSource, "pue")).toBe(stockByKey.get("pue"));
  });

  it("it_kw is the ONLY divergence — demo it_kw differs from stock it_kw", () => {
    expect(extractDemoFormula(demoSource, "it_kw")).not.toBe(stockByKey.get("it_kw"));
  });

  it("the analysis kills a mutation: {kw} in the demo it_kw formula", () => {
    const mutated = demoSource.replace(
      "it_kw: \"sum({rack_kw} @group('IT_LOAD'))\",",
      "it_kw: \"sum({kw} @group('IT_LOAD'))\",",
    );
    expect(mutated, "the mutation did not apply — the it_kw line shape changed").not.toBe(demoSource);
    expect(extractDemoFormula(mutated, "it_kw")).toBe("sum({kw} @group('IT_LOAD'))");
    expect(extractDemoFormula(mutated, "it_kw")).toBe(stockByKey.get("it_kw"));
  });
});
