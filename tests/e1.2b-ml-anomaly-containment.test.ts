import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1–S4; plan §7 T2.7) — what
 * only a scan of `apps/api/src/ml/` can hold for the anomaly reads, in the
 * `tests/e1.4a-ml-read-containment.test.ts` shape. The behaviour is asserted in
 * `ml.controller.spec.ts`, `ml-anomalies.reads.spec.ts` and
 * `ml-anomalies.integration.spec.ts`; this file holds the order of the guards,
 * the pools, and the lateral's `OFFSET 0` (the deterministic gate: the `EXPLAIN`
 * case alone is not a reliable mutation gate, the `E1.4a` build record found).
 *
 * Test and fixture files are skipped (the e1.3 rule). Assertions inline (§4.6,
 * top-level `tests/`).
 */
const MODULE_DIR = "apps/api/src/ml";
const CONTROLLER_REL = `${MODULE_DIR}/ml.controller.ts`;
const SERVICE_REL = `${MODULE_DIR}/ml-anomalies.service.ts`;
const READS_REL = `${MODULE_DIR}/ml-anomalies.reads.ts`;
const PURE_REL = `${MODULE_DIR}/ml-anomalies.pure.ts`;

/** Comments stripped: these files explain the rules they follow (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every non-test anomaly source in the module, so a new `ml-anomalies.*` file is in scope by default. */
const anomalySources = (): string[] =>
  readdirSync(join(repoRoot, MODULE_DIR))
    .filter((name) => name.startsWith("ml-anomalies.") && name.endsWith(".ts"))
    .filter((name) => !name.includes(".spec.") && !name.includes(".test."))
    .map((name) => `${MODULE_DIR}/${name}`);

const RUN_FIELDS = /\b(error_text|errorText|config_hash|configHash|rows_written|rowsWritten|model_version|modelVersion)\b/;
const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/;
const POOL_NAMES = /\b(fleetDb|tenantDb|FLEET_DRIZZLE|TENANT_DRIZZLE|FLEET_POOL|TENANT_POOL)\b/;

/** The lateral over the scores, with `OFFSET 0` on its own line before the closing `) s`. */
const LATERAL_WITH_FENCE =
  /CROSS JOIN LATERAL \(\s*SELECT s0\.[^()]*?FROM ml\.anomaly_scores s0[\s\S]*?\n\s*OFFSET 0\s*\n\s*\) s\b/;

/** The body of the method named `name`, from its signature to the next member or the class end. */
const methodBody = (code: string, name: string): string => {
  const start = code.search(new RegExp(`\\basync ${name}\\(`));
  if (start < 0) throw new Error(`no async ${name}( in the source`);
  const rest = code.slice(start);
  const end = rest.search(/\n  @|\n  async |\n}/);
  return end < 0 ? rest : rest.slice(0, end);
};

describe("E1.2b ml anomaly read containment (ADR 0135 Amendment 5 A-e)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(RUN_FIELDS.test("SELECT r.model_version FROM ml.model_runs r")).toBe(true);
    expect(RUN_FIELDS.test("SELECT r.error_text")).toBe(true);
    expect(RUN_FIELDS.test("r.model_name = $1")).toBe(false);
    expect(WRITE_VERBS.test("INSERT INTO ml.anomaly_scores")).toBe(true);
    expect(WRITE_VERBS.test("updatedAt")).toBe(false);
    expect(POOL_NAMES.test("await this.tenantDb.execute(")).toBe(true);
    expect(POOL_NAMES.test("tx.execute(")).toBe(false);
    expect(codeOnly("// model_version\n/* rows_written */\nx")).toBe("\n\nx");
    const sample =
      "CROSS JOIN LATERAL (\n  SELECT s0.asset_id\n    FROM ml.anomaly_scores s0\n   WHERE x = 1\n  OFFSET 0\n) s\n";
    expect(sample).toMatch(LATERAL_WITH_FENCE);
    expect(sample.replace("  OFFSET 0\n", "")).not.toMatch(LATERAL_WITH_FENCE);
    expect(methodBody("class C {\n  async a() {\n    one();\n  }\n\n  async b() {\n    two();\n  }\n}", "a")).not.toContain(
      "two",
    );
  });

  it("the anomaly service, reads and pure step exist, and the scan sees them", () => {
    for (const rel of [SERVICE_REL, READS_REL, PURE_REL]) {
      expect(existsSync(join(repoRoot, rel)), rel).toBe(true);
    }
    expect(anomalySources().sort()).toEqual(expect.arrayContaining([SERVICE_REL, READS_REL, PURE_REL]));
  });

  it("the one-asset handler checks the id, then parses its query, then checks access, then calls the service", () => {
    const handler = methodBody(codeOnly(read(CONTROLLER_REL)), "assetAnomalies");
    const id = handler.indexOf("assertAssetIdParam(");
    const query = handler.indexOf("assetAnomaliesQuerySchema.safeParse(");
    const guard = handler.indexOf("canReadAsset(");
    const service = handler.indexOf("this.anomalyReads.forAsset(");
    expect(id, "assertAssetIdParam( in the handler").toBeGreaterThanOrEqual(0);
    expect(query, "the query parse after the id check").toBeGreaterThan(id);
    expect(guard, "canReadAsset( after the query parse").toBeGreaterThan(query);
    expect(service, "the service call after canReadAsset(").toBeGreaterThan(guard);
  });

  it("the list handler calls readableAssetIds before the service (S1)", () => {
    const handler = methodBody(codeOnly(read(CONTROLLER_REL)), "anomalies");
    const query = handler.indexOf("anomaliesQuerySchema.safeParse(");
    const scope = handler.indexOf("readableAssetIds(");
    const service = handler.indexOf("this.anomalyReads.list(");
    expect(query).toBeGreaterThanOrEqual(0);
    expect(scope, "readableAssetIds( after the query parse").toBeGreaterThan(query);
    expect(service, "the service call after readableAssetIds(").toBeGreaterThan(scope);
    expect(handler, "readableAssetIds' value reaches the service unchanged").toMatch(
      /const assetIds = await this\.accessControl\.readableAssetIds\(user\);[\s\S]*this\.anomalyReads\.list\(assetIds,/,
    );
  });

  it("the reads file takes a transaction and never names a pool", () => {
    const reads = codeOnly(read(READS_REL));
    const match = POOL_NAMES.exec(reads);
    expect(match?.[0], `ml-anomalies.reads.ts names ${match?.[0]}`).toBeUndefined();
    expect(reads).toMatch(/\btx: BmsTx\b/);
    expect(reads).not.toMatch(/\bBmsDb\b/);
  });

  it("the service reaches each pool only as withReadScope's own argument (S4)", () => {
    const service = codeOnly(read(SERVICE_REL));
    const scoped = service.match(/withReadScope\(\s*this\.tenantDb,\s*this\.fleetDb,/g) ?? [];
    expect(scoped.length, "both reads run through withReadScope(this.tenantDb, this.fleetDb, …)").toBe(2);
    expect((service.match(/this\.tenantDb\b/g) ?? []).length).toBe(scoped.length);
    expect((service.match(/this\.fleetDb\b/g) ?? []).length).toBe(scoped.length);
    expect(service).not.toMatch(/(?:const|let)\s*\{[^}]*\b(?:fleetDb|tenantDb)\b[^}]*\}\s*=\s*this\b/);
    expect(service).not.toMatch(/(?:const|let)\s+\w+\s*=\s*this\.(?:fleetDb|tenantDb)\b/);
    expect(service).not.toMatch(/\bFLEET_POOL\b|\bTENANT_POOL\b/);
    // The one-asset read is routed by its own id (S4); the list by the caller's ids.
    expect(service).toMatch(/withReadScope\(this\.tenantDb, this\.fleetDb, \[assetId\],/);
    expect(service).toMatch(/withReadScope\(this\.tenantDb, this\.fleetDb, assetIds,/);
  });

  it("the list's asset filter is chosen by ids !== null, never by the branch (S1)", () => {
    // The service hands the read the caller's ids on both branches, never a literal or derived null.
    expect(codeOnly(read(SERVICE_REL))).toMatch(/readAnomalyList\(tx, assetIds, window\.sinceMs\)/);
    const reads = codeOnly(read(READS_REL));
    expect(reads).toMatch(/AND s0\.asset_id = ANY\(\$\{uuidArray\(ids\)\}::uuid\[\]\)/);
    expect(reads).toMatch(/const assetFilter = ids === null \? sql`` : sql`AND s0\.asset_id = ANY/);
  });

  it("the list's per-run lateral subquery keeps OFFSET 0, so the planner cannot flatten it (section 2.4)", () => {
    expect(codeOnly(read(READS_REL))).toMatch(LATERAL_WITH_FENCE);
  });

  it("no anomaly source names a run field the contract forbids (S3, R11) or holds a write verb", () => {
    const sources = anomalySources();
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const rel of sources) {
      const code = codeOnly(read(rel));
      const field = RUN_FIELDS.exec(code);
      expect(field?.[0], `${rel} names ${field?.[0]}`).toBeUndefined();
      const verb = WRITE_VERBS.exec(code);
      expect(verb?.[0], `${rel} holds ${verb?.[0]}`).toBeUndefined();
    }
  });
});
