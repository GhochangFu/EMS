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
 *
 * **The group code is derived, not copied** (code review, finding E). The demo
 * seed used to spell `IT_LOAD` inside its `it_kw` literal while importing
 * `IT_LOAD_GROUP_CODE` for the group it creates, so renaming the constant would
 * have left every gate green and made `it_kw` resolve `no_members` forever. The
 * literal now interpolates the constant, and the expected string below is built
 * from the constant's own value read out of `asset-groups-seed.ts` — a copied
 * string here would only move the same silent drift into this file. The **stock**
 * entry cannot interpolate it (`apps/api` does not depend on `packages/db`), so
 * it is checked against the same value instead: that is the one remaining way
 * the two can drift apart, and this is where it is caught.
 */
const PUE_DEMO_SEED_FILE = join(repoRoot, "packages", "db", "src", "pue-demo-seed.ts");
const ASSET_GROUPS_SEED_FILE = join(repoRoot, "packages", "db", "src", "asset-groups-seed.ts");

const IT_LOAD_CONST_RE = /export const IT_LOAD_GROUP_CODE = "([A-Za-z0-9_-]+)"/;

function itLoadGroupCode(source: string): string | null {
  const match = IT_LOAD_CONST_RE.exec(source);
  return match ? (match[1] as string) : null;
}

/**
 * One `PUE_DEMO_FORMULAS` entry as text. Accepts a quoted literal (`site_kw`,
 * `pue`) or a template literal (`it_kw`), and resolves the single interpolation
 * the module is allowed to carry against the code passed in.
 */
function extractDemoFormula(
  source: string,
  key: "site_kw" | "it_kw" | "pue",
  groupCode: string,
): string | null {
  const re = new RegExp(
    `^\\s*${key}:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|\`([^\`]*)\`),?\\s*$`,
    "m",
  );
  const match = re.exec(source);
  if (!match) {
    return null;
  }
  if (match[1] !== undefined) {
    return JSON.parse(`"${match[1]}"`) as string;
  }
  return (match[2] as string).split("${IT_LOAD_GROUP_CODE}").join(groupCode);
}

const DEMO_IT_KW_INTERPOLATES_RE = /it_kw:\s*`[^`]*\$\{IT_LOAD_GROUP_CODE\}[^`]*`/;

/**
 * Every way the demo seed, the stock entry and `IT_LOAD_GROUP_CODE` can
 * disagree, returned rather than thrown — so the real files and a mutated
 * scratch copy run through one function and the red-run proof is one call.
 */
function groupCodeDefects(demoSource: string, stockSource: string, groupsSource: string): string[] {
  const defects: string[] = [];
  const code = itLoadGroupCode(groupsSource);
  if (code === null) {
    defects.push("asset-groups-seed.ts does not export IT_LOAD_GROUP_CODE as a string literal");
    return defects;
  }
  if (!DEMO_IT_KW_INTERPOLATES_RE.test(demoSource)) {
    defects.push(
      "the demo it_kw formula spells the group code as a literal instead of interpolating IT_LOAD_GROUP_CODE",
    );
  }
  const demoItKw = extractDemoFormula(demoSource, "it_kw", code);
  const expectedDemo = `sum({rack_kw} @group('${code}'))`;
  if (demoItKw !== expectedDemo) {
    defects.push(`demo it_kw is ${JSON.stringify(demoItKw)}, expected ${JSON.stringify(expectedDemo)}`);
  }
  const stockCalls = extractFeederDerivedCalls(stockSource);
  const stockItKw = stockCalls[1]?.literal ?? null;
  const expectedStock = `sum({kw} @group('${code}'))`;
  if (stockItKw !== expectedStock) {
    defects.push(
      `stock it_kw is ${JSON.stringify(stockItKw)}, expected ${JSON.stringify(expectedStock)} — ` +
        "the stock catalog and the demo seed name different groups",
    );
  }
  return defects;
}

describe("F2.8 part (c) — pue-demo-seed.ts diverges from the stock feeder in it_kw alone", () => {
  const demoSource = readFileSync(PUE_DEMO_SEED_FILE, "utf8");
  const stockSource = readFileSync(FEEDER_FILE, "utf8");
  const groupsSource = readFileSync(ASSET_GROUPS_SEED_FILE, "utf8");
  const groupCode = itLoadGroupCode(groupsSource) as string;
  const stockCalls = extractFeederDerivedCalls(stockSource);
  const stockByKey = new Map(
    stockCalls.map((call, index) => [["site_kw", "it_kw", "pue"][index], call.literal] as const),
  );

  it("read IT_LOAD_GROUP_CODE out of asset-groups-seed.ts, so nothing below is vacuous", () => {
    expect(groupCode).toBe("IT_LOAD");
    expect(itLoadGroupCode('export const IT_LOAD_GROUP_CODE = "OTHER";')).toBe("OTHER");
  });

  it("found all three demo formulas as text", () => {
    expect(extractDemoFormula(demoSource, "site_kw", groupCode)).not.toBeNull();
    expect(extractDemoFormula(demoSource, "it_kw", groupCode)).not.toBeNull();
    expect(extractDemoFormula(demoSource, "pue", groupCode)).not.toBeNull();
  });

  it("the demo seed and the stock entry both name IT_LOAD_GROUP_CODE's own value", () => {
    expect(groupCodeDefects(demoSource, stockSource, groupsSource)).toEqual([]);
  });

  it("site_kw and pue are byte-identical between the demo seed and the stock feeder", () => {
    expect(extractDemoFormula(demoSource, "site_kw", groupCode)).toBe(stockByKey.get("site_kw"));
    expect(extractDemoFormula(demoSource, "pue", groupCode)).toBe(stockByKey.get("pue"));
  });

  it("it_kw is the ONLY divergence — demo it_kw differs from stock it_kw", () => {
    expect(extractDemoFormula(demoSource, "it_kw", groupCode)).not.toBe(stockByKey.get("it_kw"));
  });

  it("the analysis kills a mutation: renaming IT_LOAD_GROUP_CODE, and hardcoding it back", () => {
    // Rename the constant. The demo interpolates it and follows; the stock entry
    // cannot, so the two now name different groups and it_kw would resolve
    // `no_members` on every tick of every imported feeder.
    const renamed = groupsSource.replace(
      'export const IT_LOAD_GROUP_CODE = "IT_LOAD"',
      'export const IT_LOAD_GROUP_CODE = "IT_RACK_LOAD"',
    );
    expect(renamed, "the mutation did not apply — the constant's shape changed").not.toBe(
      groupsSource,
    );
    expect(groupCodeDefects(demoSource, stockSource, renamed).join("\n")).toContain(
      "the stock catalog and the demo seed name different groups",
    );

    // Put the literal back into the demo formula: the drift this finding is about.
    const hardcoded = demoSource.replace(
      DEMO_IT_KW_INTERPOLATES_RE,
      "it_kw: \"sum({rack_kw} @group('IT_LOAD'))\"",
    );
    expect(hardcoded, "the mutation did not apply — the it_kw line shape changed").not.toBe(
      demoSource,
    );
    expect(groupCodeDefects(hardcoded, stockSource, groupsSource)).toContain(
      "the demo it_kw formula spells the group code as a literal instead of interpolating IT_LOAD_GROUP_CODE",
    );
  });
});

// --- part (d) — the section counts in ELECTRICAL_CLASS_POINT_KEYS ---------

/**
 * `packages/shared/src/constants.ts` files its electrical vocabulary in six
 * commented sections, each headed `// §N <name> — <count>`. `F2.8` appended
 * `site_kw`, `it_kw` and `pue` to §1 and left the heading reading 15 (code
 * review, finding G), which is the sort of stale number a later reader trusts
 * and a later author copies. Nothing scanned these headings before; this is
 * where they are held, for every section rather than only the one that drifted.
 */
const CONSTANTS_FILE = join(repoRoot, "packages", "shared", "src", "constants.ts");

const SECTION_HEADING_RE = /^\s*\/\/ (§\d+ .*?) — (\d+)\s*$/;
const KEY_LINE_RE = /^\s*"[a-z0-9_]+",/;

type Section = { heading: string; declared: number; actual: number };

function electricalSections(source: string): Section[] {
  const start = source.indexOf("export const ELECTRICAL_CLASS_POINT_KEYS = [");
  if (start === -1) {
    return [];
  }
  const end = source.indexOf("\n] as const;", start);
  const body = source.slice(start, end === -1 ? undefined : end);
  const sections: Section[] = [];
  for (const line of body.split("\n")) {
    const heading = SECTION_HEADING_RE.exec(line);
    if (heading) {
      sections.push({ heading: heading[1] as string, declared: Number(heading[2]), actual: 0 });
      continue;
    }
    if (KEY_LINE_RE.test(line) && sections.length > 0) {
      (sections[sections.length - 1] as Section).actual += 1;
    }
  }
  return sections;
}

describe("F2.8 part (d) — every ELECTRICAL_CLASS_POINT_KEYS section heading counts its own keys", () => {
  const source = readFileSync(CONSTANTS_FILE, "utf8");
  const sections = electricalSections(source);

  it("found all six sections, so the comparison below is not silently empty", () => {
    expect(sections.map((s) => s.heading.slice(0, 2))).toEqual(["§1", "§2", "§3", "§4", "§5", "§6"]);
  });

  it("each heading's declared count equals the keys under it", () => {
    const wrong = sections
      .filter((s) => s.declared !== s.actual)
      .map((s) => `${s.heading}: heading says ${s.declared}, the array holds ${s.actual}`);
    expect(wrong).toEqual([]);
  });

  it("the six sections sum to the 148 keys the docblock claims F2.12 and F2.8 left behind", () => {
    expect(sections.reduce((total, s) => total + s.actual, 0)).toBe(148);
    expect(source).toContain("145 → 148");
  });

  it("the analysis kills a mutation: a heading whose count is one out", () => {
    const mutated = source.replace("// §6 capacitor bank / APFC — 13", "// §6 capacitor bank / APFC — 12");
    expect(mutated, "the mutation did not apply — the §6 heading changed").not.toBe(source);
    const wrong = electricalSections(mutated).filter((s) => s.declared !== s.actual);
    expect(wrong.map((s) => s.heading)).toEqual(["§6 capacitor bank / APFC"]);
  });
});
