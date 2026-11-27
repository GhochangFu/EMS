import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.3, R-a, R-d, R-g) — what only a scan
 * can hold for the health inputs, in the `tests/e1.9-ml-findings-containment.test.ts`
 * shape. The behaviour (the readable set reaches the service by reference, a
 * failed fact is quiet, the anomaly read gets exactly the in-scope ids, two
 * organizations never mix) is asserted in `health-inputs.controller.spec.ts`,
 * `health-inputs.service.spec.ts` and `health-inputs.integration.spec.ts`.
 * This file holds the order of the guards in each handler, the pools, that the
 * reads reach the scores only through the imported chain and never name the
 * table, that `E1.3`'s rule score imports nothing of this, and that nothing in
 * reports, notifications, work orders, alarms, the copilot, the dashboards,
 * maintenance, `ml` or the queue reaches it.
 *
 * `tests/e1.3-health-containment.test.ts` (unedited) already holds that every
 * route in `apps/api/src/asset-health/` has an access check in its own body.
 *
 * Test and fixture files are skipped (the e1.3 rule). Assertions inline (§4.6,
 * top-level `tests/`).
 */
const MODULE_DIR = "apps/api/src/asset-health";
const CONTROLLER_REL = `${MODULE_DIR}/health-inputs.controller.ts`;
const SERVICE_REL = `${MODULE_DIR}/health-inputs.service.ts`;
const READS_REL = `${MODULE_DIR}/health-inputs.reads.ts`;
const CONTRACT_REL = "packages/shared/src/contracts/asset-health-inputs.ts";

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
const SCORES_TABLE = /\banomaly_scores\b/;
const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i;
const RUN_FIELDS = /\b(error_text|config_hash|rows_written|model_version)\b/;
const LITERAL_LINE = /\b0\.99\b/;
const LITERAL_CAP = /\b0\.05\b/;
const INPUTS_IMPORT = /from\s+["']\.\/health-inputs[^"']*["']/;
const ML_IMPORT = /from\s+["']\.\.\/ml(\/[^"']*)?["']/;
const ADVISORY_FIELDS = /\b(losingAssetCount|advisoryScore|advisoryHealthScore|penalty|HEALTH_ANOMALY_\w+|anomalyHistory|unusualHours|strongHours)\b/;
const INPUTS_NAMES = /health-inputs|asset-health-inputs|HealthInputsService|advisoryHealthScore|healthAnomalyPenalty|bad-actors/;

/** The body of the method named `name`, from its signature to the next member or the class end. */
const methodBody = (code: string, name: string): string => {
  const start = code.search(new RegExp(`\\basync ${name}\\(`));
  if (start < 0) throw new Error(`no async ${name}( in the source`);
  const rest = code.slice(start);
  const end = rest.search(/\n  @|\n  async |\n}/);
  return end < 0 ? rest : rest.slice(0, end);
};

/** The `withReadScope(…)` call that starts at `at`, to its closing parenthesis. */
const callAt = (code: string, at: number): string => {
  let depth = 0;
  for (let i = code.indexOf("(", at); i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    if (code[i] === ")") depth -= 1;
    if (depth === 0) return code.slice(at, i + 1);
  }
  return code.slice(at);
};
const scopedCalls = (code: string): string[] =>
  [...code.matchAll(/withReadScope\(/g)].map((m) => callAt(code, m.index ?? 0));

describe("E1.8a health inputs containment (ADR 0050 Amendment 5)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(POOL_NAMES.test("await this.fleetDb.execute(")).toBe(true);
    expect(POOL_NAMES.test("tx.execute(")).toBe(false);
    expect(SCORES_TABLE.test("FROM ml.anomaly_scores s0")).toBe(true);
    expect(SCORES_TABLE.test("currentAnomalyScoresCte(ids, sinceMs)")).toBe(false);
    expect(WRITE_VERBS.test("INSERT INTO bms.work_orders")).toBe(true);
    expect(WRITE_VERBS.test("SELECT count(*) FROM bms.work_orders")).toBe(false);
    expect(RUN_FIELDS.test("r.model_version")).toBe(true);
    expect(RUN_FIELDS.test("r.started_at")).toBe(false);
    expect(LITERAL_LINE.test("score >= 0.99")).toBe(true);
    expect(LITERAL_LINE.test("0.995")).toBe(false);
    expect(LITERAL_CAP.test("Math.min(0.05, share)")).toBe(true);
    expect(LITERAL_CAP.test("0.055")).toBe(false);
    expect(INPUTS_IMPORT.test('import { x } from "./health-inputs.pure";')).toBe(true);
    expect(INPUTS_IMPORT.test('import { x } from "./health-score";')).toBe(false);
    expect(ML_IMPORT.test('import { x } from "../ml/ml-anomalies.reads";')).toBe(true);
    expect(ML_IMPORT.test('import { x } from "../ml-findings/x";')).toBe(false);
    expect(INPUTS_NAMES.test('@Get("bad-actors")')).toBe(true);
    expect(INPUTS_NAMES.test("advisoryHealthScore(score, penalty)")).toBe(true);
    expect(INPUTS_NAMES.test("healthSummaryResponseSchema")).toBe(false);
    expect(ADVISORY_FIELDS.test("    losingAssetCount: z.number().int().nonnegative(),")).toBe(true);
    expect(ADVISORY_FIELDS.test("    scoredAssetCount: z.number().int().nonnegative(),")).toBe(false);
    expect(isSource("health-inputs.fixture.ts")).toBe(false);
    expect(isSource("health-inputs.reads.ts")).toBe(true);
    expect(codeOnly("// 0.99\n/* ../ml */\nx")).toBe("\n\nx");
    const call = "withReadScope(this.tenantDb, this.fleetDb, [assetId], () => undefined, (tx) => read(tx, [assetId], 1))";
    expect(scopedCalls(`a; ${call}; b`)).toEqual([call]);
  });

  it("the files exist and the scans see them", () => {
    for (const rel of [CONTROLLER_REL, SERVICE_REL, READS_REL, CONTRACT_REL]) {
      expect(existsSync(join(repoRoot, rel)), rel).toBe(true);
    }
    expect(sourcesUnder(MODULE_DIR)).toEqual(expect.arrayContaining([CONTROLLER_REL, SERVICE_REL, READS_REL]));
    expect(sourcesUnder("apps/api/src/copilot").length).toBeGreaterThan(5);
    expect(sourcesUnder("packages/shared/src/copilot").length).toBeGreaterThan(0);
    expect(sourcesUnder("apps/api/src/reports").length).toBeGreaterThan(3);
    expect(sourcesUnder("apps/api/src/ml").length).toBeGreaterThan(10);
  });

  it("the controller is under JwtAuthGuard, declares exactly 2 routes, and checks before it reads", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    expect(code).toContain('@Controller("asset-health")');
    expect(code).toContain("@UseGuards(JwtAuthGuard)");
    const bodies = code.split(ROUTE_DECORATOR).slice(1).filter((_, index) => index % 2 === 1);
    expect(bodies.length, "the controller declares its two routes").toBe(2);
    expect(code).toContain('@Get("assets/:assetId/inputs")');
    expect(code).toContain('@Get("bad-actors")');

    const inputs = methodBody(code, "forAsset");
    const idCheck = inputs.indexOf("assertAssetIdParam(");
    const access = inputs.indexOf("canReadAsset(");
    const call = inputs.indexOf("this.inputs.forAsset(");
    expect(idCheck, "forAsset: the id check").toBeGreaterThanOrEqual(0);
    expect(access, "forAsset: canReadAsset after the id check").toBeGreaterThan(idCheck);
    expect(call, "forAsset: the service after canReadAsset").toBeGreaterThan(access);

    const bad = methodBody(code, "badActors");
    const parse = bad.indexOf("healthBadActorsQuerySchema.safeParse(");
    const readable = bad.indexOf("readableAssetIds");
    const service = bad.indexOf("this.inputs.badActors(assetIds,");
    expect(parse, "badActors: the query parse").toBeGreaterThanOrEqual(0);
    expect(readable, "badActors: the readable set after the parse").toBeGreaterThan(parse);
    expect(service, "badActors: the service after the readable set").toBeGreaterThan(readable);
    expect(bad.match(/\bassetIds\s*=/g) ?? [], "assetIds is assigned once, from access control").toHaveLength(1);
    const serviceCall = callAt(bad, service);
    expect(serviceCall, "the organization id is never an argument of the service call").not.toMatch(/organizationId/);
  });

  it("the service reaches each pool only as withReadScope's own arguments, routed by the ids it reads", () => {
    const service = codeOnly(read(SERVICE_REL));
    const scoped = service.match(/withReadScope\(\s*this\.tenantDb,\s*this\.fleetDb,/g) ?? [];
    expect(scoped.length, "two fact reads, the label read and the list's anomaly read").toBe(4);
    expect((service.match(/this\.tenantDb\b/g) ?? []).length).toBe(scoped.length);
    expect((service.match(/this\.fleetDb\b/g) ?? []).length).toBe(scoped.length);
    expect(service).not.toMatch(/(?:const|let)\s*\{[^}]*\b(?:fleetDb|tenantDb)\b[^}]*\}\s*=\s*this\b/);
    expect(service).not.toMatch(/(?:const|let)\s+\w+\s*=\s*this\.(?:fleetDb|tenantDb)\b/);
    expect(service).not.toMatch(/\bFLEET_POOL\b|\bTENANT_POOL\b/);
    expect(service, "no Promise.all: one read at a time").not.toMatch(/Promise\.all/);

    const calls = scopedCalls(service);
    expect(calls).toHaveLength(4);
    const hoursCalls = calls.filter((c) => c.includes("readAnomalyHealthHours("));
    expect(hoursCalls).toHaveLength(2);
    expect(
      hoursCalls.some((c) => /^withReadScope\(this\.tenantDb, this\.fleetDb, \[assetId\],[\s\S]*readAnomalyHealthHours\(tx, \[assetId\],/.test(c)),
      "the one-asset read is routed by, and filters by, [assetId]",
    ).toBe(true);
    expect(
      hoursCalls.some((c) => /^withReadScope\(this\.tenantDb, this\.fleetDb, inScopeIds,[\s\S]*readAnomalyHealthHours\(tx, inScopeIds,/.test(c)),
      "the list's read is routed by, and filters by, inScopeIds",
    ).toBe(true);
    const ticket = calls.filter((c) => c.includes("readOpenCorrective("));
    expect(ticket).toHaveLength(1);
    expect(ticket[0]).toMatch(/^withReadScope\(this\.tenantDb, this\.fleetDb, \[assetId\],[\s\S]*readOpenCorrective\(tx, assetId,/);
    const labels = calls.filter((c) => c.includes("readAssetLabels("));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/^withReadScope\(this\.tenantDb, this\.fleetDb, inScopeIds,/);
    for (const c of calls) {
      expect(c.match(/\bread\w+\(tx,/g) ?? [], `each fact read is its own transaction: ${c.slice(0, 120)}`).toHaveLength(1);
    }
  });

  it("the reads take a transaction, name no pool, never name the scores table, and write nothing", () => {
    const reads = codeOnly(read(READS_REL));
    const pool = POOL_NAMES.exec(reads);
    expect(pool?.[0], `health-inputs.reads.ts names ${pool?.[0]}`).toBeUndefined();
    expect(reads).toMatch(/\btx: BmsTx\b/);
    expect(reads).not.toMatch(/\bBmsDb\b/);
    expect(reads).not.toMatch(SCORES_TABLE);
    expect(reads).toContain("${currentAnomalyScoresCte(ids, sinceMs)}");
    expect(reads).toMatch(/import \{ currentAnomalyScoresCte \} from "\.\.\/ml\/ml-anomalies\.reads";/);
    expect(WRITE_VERBS.exec(reads)?.[0]).toBeUndefined();
    expect(RUN_FIELDS.exec(reads)?.[0]).toBeUndefined();
  });

  it("no source restates the unusual-score line; the cap is written in the contract only", () => {
    const inputsSources = sourcesUnder(MODULE_DIR).filter((rel) => /\/health-inputs\.[^/]+$/.test(rel));
    expect(inputsSources.length).toBeGreaterThanOrEqual(5);
    for (const rel of [...inputsSources, CONTRACT_REL]) {
      expect(LITERAL_LINE.test(codeOnly(read(rel))), `${rel}: 0.99`).toBe(false);
    }
    for (const rel of inputsSources) {
      expect(LITERAL_CAP.test(codeOnly(read(rel))), `${rel}: 0.05`).toBe(false);
    }
    expect(codeOnly(read(CONTRACT_REL))).toMatch(/export const HEALTH_ANOMALY_CAP = 0\.05;/);
  });

  it("E1.3 stays rule-only: its files import nothing of the inputs or of ml", () => {
    const e13 = sourcesUnder(MODULE_DIR).filter((rel) =>
      /\/(asset-health\.controller|asset-health\.service|asset-health\.schema|health-score|health-rollup[^/]*|in-range-sql)\.ts$/.test(rel),
    );
    expect(e13.length, "the six E1.3 files and the roll-up's two").toBeGreaterThanOrEqual(6);
    for (const rel of e13) {
      const code = read(rel);
      expect(INPUTS_IMPORT.exec(code)?.[0], `${rel} imports the inputs`).toBeUndefined();
      expect(ML_IMPORT.exec(code)?.[0], `${rel} imports ml`).toBeUndefined();
    }
    const healthContract = codeOnly(read("packages/shared/src/contracts/health.ts"));
    expect(healthContract).not.toMatch(/asset-health-inputs/);
    // R-e: the count rides on the bad-actors response; the summary (which feeds the copilot tool and
    // the metric) carries no advisory field.
    expect(healthContract).toContain("healthSummaryResponseSchema");
    expect(ADVISORY_FIELDS.exec(healthContract)?.[0], "contracts/health.ts names an advisory field").toBeUndefined();
  });

  it("nothing in reports, notifications, work orders, alarms, the copilot, dashboards, maintenance, ml or the queue reaches it", () => {
    const dirs = [
      "reports",
      "notifications",
      "work-orders",
      "alarms",
      "copilot",
      "dashboard",
      "dashboard-builder",
      "maintenance",
      "ml",
      "ml-findings",
      "queue",
    ].map((d) => `apps/api/src/${d}`);
    let scanned = 0;
    for (const rel of [...dirs.flatMap(sourcesUnder), ...sourcesUnder("packages/shared/src/copilot")]) {
      scanned += 1;
      const match = INPUTS_NAMES.exec(read(rel));
      expect(match?.[0], `${rel} names ${match?.[0]}`).toBeUndefined();
    }
    expect(scanned).toBeGreaterThan(50);
  });
});
