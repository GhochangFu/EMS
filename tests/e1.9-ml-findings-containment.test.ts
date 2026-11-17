import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan R-a, R-b, T1.3) — what only a scan can
 * hold for the findings facts, in the `tests/e1.4a-ml-read-containment.test.ts`
 * shape. The behaviour (the parsed keys reach `narrow`, its value reaches the
 * service, two organizations never mix, the poison rule gives no line) is
 * asserted in `ml-findings.controller.spec.ts`, the fact builders' specs and
 * `ml-findings.integration.spec.ts`. This file holds the order of the guards,
 * the pools, the hand-carried organization predicate, the `OFFSET 0` fences,
 * and the module edges: nothing under `apps/api/src/ml/` reaches the LLM or the
 * copilot, and nothing in the copilot, reports, notifications or work orders
 * reaches the findings.
 *
 * Test and fixture files are skipped (the e1.3 rule). Assertions inline (§4.6,
 * top-level `tests/`).
 */
const MODULE_DIR = "apps/api/src/ml";
const CONTROLLER_REL = `${MODULE_DIR}/ml-findings.controller.ts`;
const SERVICE_REL = `${MODULE_DIR}/ml-findings.service.ts`;
const READS_REL = `${MODULE_DIR}/ml-findings.reads.ts`;
const ANOMALY_READS_REL = `${MODULE_DIR}/ml-anomalies.reads.ts`;

/** Comments stripped: these files explain the rules they follow (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const isSource = (name: string): boolean =>
  /\.(ts|tsx)$/.test(name) && !name.includes(".spec.") && !name.includes(".test.") && !name.includes(".fixture.");

/** Every non-test source under `dir`, recursively. */
const sourcesUnder = (dir: string): string[] => {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) return sourcesUnder(rel);
    return isSource(name) ? [rel] : [];
  });
};

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|All)\s*\(/g;
const POOL_NAMES = /\b(fleetDb|tenantDb|FLEET_DRIZZLE|TENANT_DRIZZLE|FLEET_POOL|TENANT_POOL)\b/;
const LLM_IMPORT = /from\s+["']\.\.\/(llm|copilot|ml-findings)(\/[^"']*)?["']/;
const FINDINGS_NAME = /ml-findings|findings\/paragraph/;
const ML_IMPORT = /from\s+["']\.\.\/ml(\/[^"']*)?["']/;
const LITERAL_LINE = /\b0\.99\b/;
/** A `CROSS JOIN LATERAL ( … )` block whose last line before the closing `) alias` is `OFFSET 0`. */
const LATERAL_BLOCK = /CROSS JOIN LATERAL \(([\s\S]*?)\n\s*\) \w+\b/g;
const FENCED = /\n\s*(LIMIT 1 )?OFFSET 0\s*$/;

/** The body of the method named `name`, from its signature to the next member or the class end. */
const methodBody = (code: string, name: string): string => {
  const start = code.search(new RegExp(`\\basync ${name}\\(`));
  if (start < 0) throw new Error(`no async ${name}( in the source`);
  const rest = code.slice(start);
  const end = rest.search(/\n  @|\n  async |\n}/);
  return end < 0 ? rest : rest.slice(0, end);
};

/** The source of the exported function `name`, to the next top-level `export`. */
const functionSource = (code: string, name: string): string => {
  const start = code.search(new RegExp(`export function ${name}\\(`));
  if (start < 0) throw new Error(`no export function ${name}( in the source`);
  const rest = code.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? rest : rest.slice(0, end);
};

const laterals = (code: string): string[] => [...code.matchAll(LATERAL_BLOCK)].map((m) => m[1] ?? "");

describe("E1.9a ml findings containment (ADR 0135 Amendment 8)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(POOL_NAMES.test("await this.fleetDb.execute(")).toBe(true);
    expect(POOL_NAMES.test("tx.execute(")).toBe(false);
    expect(LLM_IMPORT.test('import { LlmResolver } from "../llm/llm-resolver";')).toBe(true);
    expect(LLM_IMPORT.test('import { x } from "../copilot";')).toBe(true);
    expect(LLM_IMPORT.test('import { x } from "../ml-findings/ml-findings-paragraph.service";')).toBe(true);
    expect(LLM_IMPORT.test('import { x } from "./ml-findings.lines";')).toBe(false);
    expect(LLM_IMPORT.test('import { x } from "../llm-tools/x";')).toBe(false);
    expect(FINDINGS_NAME.test("GET /ml/findings/paragraph")).toBe(true);
    expect(FINDINGS_NAME.test("import from '../ml/ml-findings.service'")).toBe(true);
    expect(FINDINGS_NAME.test("findings")).toBe(false);
    expect(ML_IMPORT.test('import { MlFindingsService } from "../ml/ml-findings.service";')).toBe(true);
    expect(ML_IMPORT.test('import { x } from "../mlx/y";')).toBe(false);
    expect(LITERAL_LINE.test("score >= 0.99")).toBe(true);
    expect(LITERAL_LINE.test("0.995")).toBe(false);
    const fenced = "CROSS JOIN LATERAL (\n  SELECT 1\n    FROM t\n  OFFSET 0\n) f\n";
    expect(laterals(fenced).every((body) => FENCED.test(body))).toBe(true);
    expect(laterals(fenced.replace("  OFFSET 0\n", "")).every((body) => FENCED.test(body))).toBe(false);
    expect(laterals("CROSS JOIN LATERAL (\n  SELECT 1\n  LIMIT 1 OFFSET 0\n) fb\n").every((b) => FENCED.test(b))).toBe(true);
    expect(isSource("ml-findings.fixture.ts")).toBe(false);
    expect(isSource("ml-findings.reads.ts")).toBe(true);
    expect(codeOnly("// 0.99\n/* ../llm */\nx")).toBe("\n\nx");
  });

  it("the findings files exist and the scans see them", () => {
    for (const rel of [CONTROLLER_REL, SERVICE_REL, READS_REL]) {
      expect(existsSync(join(repoRoot, rel)), rel).toBe(true);
    }
    expect(sourcesUnder(MODULE_DIR)).toEqual(expect.arrayContaining([CONTROLLER_REL, SERVICE_REL, READS_REL]));
    expect(sourcesUnder("apps/api/src/copilot").length).toBeGreaterThan(5);
    expect(sourcesUnder("packages/shared/src/copilot").length).toBeGreaterThan(0);
    expect(sourcesUnder("apps/api/src/reports").length).toBeGreaterThan(3);
  });

  it("the controller is under JwtAuthGuard, declares exactly 2 routes, each parses, then narrows, then calls the service", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    expect(code).toContain("@UseGuards(JwtAuthGuard)");
    expect(code).toContain('@Controller("ml")');
    const bodies = code.split(ROUTE_DECORATOR).slice(1).filter((_, index) => index % 2 === 1);
    expect(bodies.length, "the controller declares its two summary routes").toBe(2);
    for (const [name, service] of [
      ["forecastSummary", "this.findings.forecastSummary("],
      ["anomalySummary", "this.findings.anomalySummary("],
    ] as const) {
      const handler = methodBody(code, name);
      const query = handler.indexOf("mlFindingsSummaryQuerySchema.safeParse(");
      const scope = handler.indexOf("this.assetFilterScope.narrow(user, parsed.data)");
      const call = handler.indexOf(service);
      expect(query, `${name}: the query parse`).toBeGreaterThanOrEqual(0);
      expect(scope, `${name}: narrow after the parse`).toBeGreaterThan(query);
      expect(call, `${name}: the service after narrow`).toBeGreaterThan(scope);
      expect(handler, `${name}: narrow's value reaches the service`).toMatch(
        new RegExp(`const assetIds = await this\\.assetFilterScope\\.narrow\\(user, parsed\\.data\\);[\\s\\S]*${service.replace(/[.()]/g, "\\$&")}assetIds,`),
      );
      expect(handler, `${name}: never readableAssetIds itself`).not.toMatch(/readableAssetIds\(/);
    }
  });

  it("the service reaches each pool only as withReadScope's own argument (S4)", () => {
    const service = codeOnly(read(SERVICE_REL));
    const scoped = service.match(/withReadScope\(\s*this\.tenantDb,\s*this\.fleetDb,/g) ?? [];
    expect(scoped.length, "both facts reads run through withReadScope(this.tenantDb, this.fleetDb, …)").toBe(2);
    expect((service.match(/this\.tenantDb\b/g) ?? []).length).toBe(scoped.length);
    expect((service.match(/this\.fleetDb\b/g) ?? []).length).toBe(scoped.length);
    expect(service).not.toMatch(/(?:const|let)\s*\{[^}]*\b(?:fleetDb|tenantDb)\b[^}]*\}\s*=\s*this\b/);
    expect(service).not.toMatch(/(?:const|let)\s+\w+\s*=\s*this\.(?:fleetDb|tenantDb)\b/);
    expect(service).not.toMatch(/\bFLEET_POOL\b|\bTENANT_POOL\b/);
    expect(service).toMatch(/withReadScope\(this\.tenantDb, this\.fleetDb, assetIds,/);
    expect(service, "no Promise.all: one connection, reads in order").not.toMatch(/Promise\.all/);
  });

  it("the findings reads take a transaction, name no pool, and never name the scores table", () => {
    const reads = codeOnly(read(READS_REL));
    const match = POOL_NAMES.exec(reads);
    expect(match?.[0], `ml-findings.reads.ts names ${match?.[0]}`).toBeUndefined();
    expect(reads).toMatch(/\btx: BmsTx\b/);
    expect(reads).not.toMatch(/\bBmsDb\b/);
    expect(reads).not.toMatch(/\banomaly_scores\b/);
  });

  it("every new statement that filters assets binds = ANY(uuidArray(…)) chosen by ids === null (S1)", () => {
    const reads = codeOnly(read(READS_REL));
    const anomalies = codeOnly(read(ANOMALY_READS_REL));
    const forecastChain = codeOnly(read(`${MODULE_DIR}/ml-forecasts.reads.ts`));
    for (const [code, name] of [
      [forecastChain, "currentForecastRunsCte"],
      [reads, "forecastOrganizationsStatement"],
      [anomalies, "currentAnomalyScoresCte"],
      [anomalies, "anomalyOrganizationsStatement"],
    ] as const) {
      const fn = functionSource(code, name);
      expect(fn, name).toMatch(/= ANY\(\$\{uuidArray\(ids\)\}::uuid\[\]\)/);
      expect(fn, `${name}: the variant is chosen by ids === null`).toMatch(/ids === null \? sql`` :/);
    }
    // The two findings statements reuse the list's chains, so they filter on the same line.
    expect(functionSource(reads, "forecastFindingsStatement")).toMatch(/\$\{currentForecastRunsCte\(ids, currentHourMs\)\}/);
    expect(functionSource(anomalies, "anomalyFindingsStatement")).toMatch(/\$\{currentAnomalyScoresCte\(ids, sinceMs\)\}/);
    expect(functionSource(forecastChain, "forecastListStatement")).toMatch(/\$\{currentForecastRunsCte\(ids, currentHourMs\)\}/);
    expect(functionSource(anomalies, "anomalyListStatement")).toMatch(/\$\{currentAnomalyScoresCte\(ids, sinceMs\)\}/);
  });

  it("the rule read carries the organization by hand (ADR 0059 decision 9) and selects no severity", () => {
    const fn = functionSource(codeOnly(read(READS_REL)), "thresholdRulesStatement");
    expect(fn).toContain("JOIN bms.assets a ON a.id = r.asset_id AND a.organization_id = r.organization_id");
    expect(fn).toContain("r.enabled");
    expect(fn).toContain("r.lifecycle_status = 'published'");
    expect(fn).toContain("r.rule_type = 'threshold'");
    expect(fn).toContain("r.operator IN ('gt', 'gte', 'lt', 'lte')");
    expect(fn).not.toMatch(/\bseverity\b/);
  });

  it("every new lateral keeps its OFFSET 0 fence", () => {
    const reads = codeOnly(read(READS_REL));
    const blocks = laterals(reads);
    expect(blocks.length, "the findings read's two laterals and the organization read's one").toBe(3);
    for (const body of blocks) expect(body, body.slice(0, 200)).toMatch(FENCED);
    const anomalies = codeOnly(read(ANOMALY_READS_REL));
    const orgRead = laterals(functionSource(anomalies, "anomalyOrganizationsStatement"));
    expect(orgRead).toHaveLength(1);
    for (const body of laterals(anomalies)) expect(body, body.slice(0, 200)).toMatch(FENCED);
  });

  it("no file under apps/api/src/ml/ imports the LLM, the copilot or the paragraph module", () => {
    const sources = sourcesUnder(MODULE_DIR);
    expect(sources.length).toBeGreaterThanOrEqual(15);
    for (const rel of sources) {
      const match = LLM_IMPORT.exec(read(rel));
      expect(match?.[0], `${rel} imports ${match?.[0]}`).toBeUndefined();
    }
  });

  it("no ml-findings source restates the unusual-score line", () => {
    const findings = sourcesUnder(MODULE_DIR).filter((rel) => /\/ml-findings\.[^/]+$/.test(rel));
    expect(findings.length).toBeGreaterThanOrEqual(7);
    for (const rel of [...findings, ANOMALY_READS_REL, "packages/shared/src/contracts/ml-findings.ts"]) {
      expect(LITERAL_LINE.test(codeOnly(read(rel))), rel).toBe(false);
    }
  });

  it("nothing in the copilot names the findings; nothing in reports, notifications or work orders imports ml", () => {
    for (const rel of [...sourcesUnder("apps/api/src/copilot"), ...sourcesUnder("packages/shared/src/copilot")]) {
      expect(FINDINGS_NAME.test(read(rel)), rel).toBe(false);
    }
    for (const dir of ["apps/api/src/reports", "apps/api/src/notifications", "apps/api/src/work-orders"]) {
      for (const rel of sourcesUnder(dir)) {
        const match = ML_IMPORT.exec(read(rel));
        expect(match?.[0], `${rel} imports ${match?.[0]}`).toBeUndefined();
      }
    }
  });
});
