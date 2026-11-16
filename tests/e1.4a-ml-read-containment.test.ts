import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `E1.4a` / ADR 0135 Amendment 3 S1–S4 — what only a scan of `apps/api/src/ml/`
 * can hold, in the `tests/e1.3-health-containment.test.ts` shape. Plan §5 T1.9
 * and §16 security 3.
 *
 * The behaviour (the decoded pair reaches the service, `readableAssetIds`' value
 * is what the list reads, both branches filter) is asserted in
 * `ml.controller.spec.ts` and `ml-forecasts.integration.spec.ts`. This file
 * holds the half a behavioural test cannot: that no source in the module can
 * carry a run field the contract forbids (S3), write, reach a pool outside
 * `withReadScope` (S4), or decode a ref with anything but the bounded guard (S2).
 *
 * Test and fixture files are skipped (the e1.3 rule): the integration fixtures
 * must name `config_hash` and `rows_written` to plant a run. Assertions inline
 * (§4.6, top-level `tests/`).
 */
const MODULE_DIR = "apps/api/src/ml";
const CONTROLLER_REL = `${MODULE_DIR}/ml.controller.ts`;
const SERVICE_REL = `${MODULE_DIR}/ml-forecasts.service.ts`;
const READS_REL = `${MODULE_DIR}/ml-forecasts.reads.ts`;

/** Comments stripped: these files explain the rules they follow (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every non-test source in the module, so a new file is in scope by default. */
const moduleSources = (): string[] =>
  readdirSync(join(repoRoot, MODULE_DIR))
    .filter((name) => name.endsWith(".ts") && !name.includes(".spec.") && !name.includes(".test."))
    .map((name) => `${MODULE_DIR}/${name}`);

const FORBIDDEN_NAMES = /\b(error_text|errorText|config_hash|configHash|rows_written|rowsWritten|anomaly_scores)\b/;
const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/;
const POOL_NAMES = /\b(fleetDb|tenantDb|FLEET_DRIZZLE|TENANT_DRIZZLE|FLEET_POOL|TENANT_POOL)\b/;
const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|All)\s*\(/g;

/** The body of the method named `name`, from its signature to the next member or the class end. */
const methodBody = (code: string, name: string): string => {
  const start = code.search(new RegExp(`\\basync ${name}\\(`));
  if (start < 0) throw new Error(`no async ${name}( in the source`);
  const rest = code.slice(start);
  const end = rest.search(/\n  @|\n  async |\n}/);
  return end < 0 ? rest : rest.slice(0, end);
};

describe("E1.4a ml read containment (ADR 0135 Amendment 3 S1–S4)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(FORBIDDEN_NAMES.test("SELECT r.config_hash FROM ml.model_runs r")).toBe(true);
    expect(FORBIDDEN_NAMES.test("FROM ml.anomaly_scores")).toBe(true);
    expect(FORBIDDEN_NAMES.test("SELECT r.model_name")).toBe(false);
    expect(WRITE_VERBS.test("DELETE FROM ml.forecasts")).toBe(true);
    expect(WRITE_VERBS.test("updatedAt")).toBe(false);
    expect(POOL_NAMES.test("await this.fleetDb.execute(")).toBe(true);
    expect(POOL_NAMES.test("tx.execute(")).toBe(false);
    expect(codeOnly("// error_text\n/* config_hash */\nx")).toBe("\n\nx");
    expect(methodBody("class C {\n  async a() {\n    one();\n  }\n\n  async b() {\n    two();\n  }\n}", "a")).not.toContain(
      "two",
    );
  });

  it("the module exists with its controller, service and reads", () => {
    for (const rel of [CONTROLLER_REL, SERVICE_REL, READS_REL]) {
      expect(existsSync(join(repoRoot, rel)), rel).toBe(true);
    }
    expect(moduleSources().length).toBeGreaterThanOrEqual(5);
  });

  it("no source names error_text, config_hash, rows_written or anomaly_scores (S3, E1.2's table)", () => {
    for (const rel of moduleSources()) {
      const match = FORBIDDEN_NAMES.exec(codeOnly(read(rel)));
      expect(match?.[0], `${rel} names ${match?.[0]}`).toBeUndefined();
    }
  });

  it("no source holds a write verb: the module only reads", () => {
    for (const rel of moduleSources()) {
      const match = WRITE_VERBS.exec(codeOnly(read(rel)));
      expect(match?.[0], `${rel} holds ${match?.[0]}`).toBeUndefined();
    }
  });

  it("every route sits behind JwtAuthGuard and checks access in its own body", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    expect(code).toContain("@UseGuards(JwtAuthGuard)");
    const bodies = code.split(ROUTE_DECORATOR).slice(1).filter((_, index) => index % 2 === 1);
    expect(bodies.length, "the controller declares its two routes").toBe(2);
    for (const body of bodies) {
      const handler = body.slice(0, body.search(/\n  @|\n}/) + 1 || body.length);
      expect(/canReadAsset\(|readableAssetIds\(/.test(handler), handler.slice(0, 300)).toBe(true);
    }
  });

  it("the one-point handler decodes with the bounded guard, then checks access, then calls the service (S2)", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    const handler = methodBody(code, "pointForecast");
    const decode = handler.indexOf("decodeBoundedPointRef(");
    const guard = handler.indexOf("canReadAsset(");
    const service = handler.indexOf("this.forecasts.current(");
    expect(decode, "decodeBoundedPointRef( in the handler").toBeGreaterThanOrEqual(0);
    expect(guard, "canReadAsset( after the decode").toBeGreaterThan(decode);
    expect(service, "the service call after canReadAsset(").toBeGreaterThan(guard);
    for (const rel of moduleSources()) {
      const source = codeOnly(read(rel));
      expect(source, `${rel}: the bare decoder`).not.toMatch(/\bdecodePointRefParam\b/);
      expect(source, `${rel}: the unbounded guard`).not.toMatch(/\bdecodeGuardedPointRef\b/);
    }
  });

  it("the list handler hands readableAssetIds to the service", () => {
    const handler = methodBody(codeOnly(read(CONTROLLER_REL)), "list");
    const scope = handler.indexOf("readableAssetIds(");
    const service = handler.indexOf("this.forecasts.list(");
    expect(scope).toBeGreaterThanOrEqual(0);
    expect(service).toBeGreaterThan(scope);
  });

  it("the service reaches each pool only as withReadScope's own argument (S4)", () => {
    const service = codeOnly(read(SERVICE_REL));
    const scoped = service.match(/withReadScope\(\s*this\.tenantDb,\s*this\.fleetDb,/g) ?? [];
    expect(scoped.length, "both reads run through withReadScope(this.tenantDb, this.fleetDb, …)").toBe(2);
    expect((service.match(/this\.tenantDb\b/g) ?? []).length).toBe(scoped.length);
    expect((service.match(/this\.fleetDb\b/g) ?? []).length).toBe(scoped.length);
    expect(service, "destructuring a pool off `this` hides it from the count").not.toMatch(
      /(?:const|let)\s*\{[^}]*\b(?:fleetDb|tenantDb)\b[^}]*\}\s*=\s*this\b/,
    );
    expect(service, "aliasing a pool to a local hides it from the count").not.toMatch(
      /(?:const|let)\s+\w+\s*=\s*this\.(?:fleetDb|tenantDb)\b/,
    );
    expect(service).not.toMatch(/\bFLEET_POOL\b|\bTENANT_POOL\b/);
  });

  it("the reads file takes a transaction and never names a pool (§16 security 3)", () => {
    const reads = codeOnly(read(READS_REL));
    const match = POOL_NAMES.exec(reads);
    expect(match?.[0], `ml-forecasts.reads.ts names ${match?.[0]}`).toBeUndefined();
    expect(reads).toMatch(/\btx: BmsTx\b/);
    expect(reads).not.toMatch(/\bBmsDb\b/);
  });

  it("every ml.forecasts read in the list SQL filters by asset id when ids are given (S1)", () => {
    const reads = codeOnly(read(READS_REL));
    expect(reads).toMatch(/asset_id = ANY\(\$\{[^}]+\}::uuid\[\]\)/);
    expect(reads, "the variant is chosen by ids !== null, never by the branch").toMatch(/ids === null|ids !== null/);
  });

  it("the list's per-run lateral subquery keeps OFFSET 0, so the planner cannot flatten it (R4)", () => {
    // The deterministic half of R4. The EXPLAIN case in `ml-forecasts.integration.spec.ts` checks
    // the shipped plan, but without `OFFSET 0` the flattened join and the per-run path cost about
    // the same on its fixture, so that case reddened the mutation in only some runs (build record).
    const LATERAL_WITH_FENCE = /CROSS JOIN LATERAL \(\s*SELECT f0\.[^()]*?FROM ml\.forecasts f0[\s\S]*?\n\s*OFFSET 0\s*\n\s*\) f\b/;
    const sample = "CROSS JOIN LATERAL (\n  SELECT f0.asset_id\n    FROM ml.forecasts f0\n   WHERE x = 1\n  OFFSET 0\n) f\n";
    expect(sample).toMatch(LATERAL_WITH_FENCE);
    expect(sample.replace("  OFFSET 0\n", "")).not.toMatch(LATERAL_WITH_FENCE);
    expect(codeOnly(read(READS_REL))).toMatch(LATERAL_WITH_FENCE);
  });
});
