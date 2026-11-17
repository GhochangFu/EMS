import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `E1.6a` / ADR 0137 decisions 6, 7, 8 and 9 (plan T1.6, Q6, R-c) — what only a
 * scan of `apps/api/src/advisories/` can hold. Assertions are inline (this is the
 * top-level `tests/` directory, AGENTS.md §4.6).
 *
 * - The two routes sit behind `JwtAuthGuard`; `list` parses, then narrows, then
 *   reads; `forAsset` checks `canReadAsset` before it reads.
 * - The module writes nothing and never names the `ml` tables: anomaly scores
 *   come through `MlAnomaliesService` only (decision 9).
 * - The thresholds are imported, never restated (`1.5` is `ABNORMAL_RATIO`,
 *   `0.99` is `ADVISORY_TARGET_PF` and `ANOMALY_UNUSUAL_SCORE`).
 * - Advisory only (decision 8): no import of the LLM, the copilot, alarms,
 *   notifications, work orders or the queue, and none of those names advisories.
 * - "Real" is the ML scorer's own line (Q6), held equal to `apps/ml`'s text.
 * - The template `optimisation` section stays refused (decision 10).
 */
const MODULE_DIR = "apps/api/src/advisories";
const CONTROLLER_REL = `${MODULE_DIR}/advisories.controller.ts`;
const READS_REL = `${MODULE_DIR}/advisories.reads.ts`;
const SQL_PY_REL = "apps/ml/src/bms_ml/db/sql.py";
const CONTENT_WRITES_REL = "packages/shared/src/contracts/asset-template-content-writes.ts";

const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/** Comments stripped: these files explain the rules they follow (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const isSource = (name: string): boolean =>
  /\.(ts|tsx)$/.test(name) && !name.includes(".spec.") && !name.includes(".test.") && !name.includes(".fixture.");

/** Every file under `dir` matching `keep`, recursively. */
const filesUnder = (dir: string, keep: (name: string) => boolean): string[] => {
  const abs = join(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(join(repoRoot, rel)).isDirectory()) return filesUnder(rel, keep);
    return keep(name) ? [rel] : [];
  });
};

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|All)\s*\(/g;
const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/;
const ML_TABLE = /anomaly_scores|ml\.forecasts|ml\.model_runs/;
/** A restated threshold: `1.5` or `0.99` as a number, not part of a longer one. */
const THRESHOLD_LITERAL = /(?<![\w.])(1\.5|0\.99)(?![\w.])/;
const FORBIDDEN_IMPORT = /from\s+["']\.\.\/(llm|copilot|alarms|notifications|work-orders|queue)(\/[^"']*)?["']/;
const NAMES_ADVISORIES = /advisories/i;
const REAL_LINE = /AND (\(a\.meta->>'telemetrySource' = 'mqtt' OR \(ap\.source_kind = 'measured' AND r\.ingest_enabled\)\))/;

/** The body of the method named `name`, from its signature to the next member or the class end. */
const methodBody = (code: string, name: string): string => {
  const start = code.search(new RegExp(`\\basync ${name}\\(`));
  if (start < 0) throw new Error(`no async ${name}( in the source`);
  const rest = code.slice(start);
  const end = rest.search(/\n  \/\*\*|\n  @|\n  async |\n}/);
  return end < 0 ? rest : rest.slice(0, end);
};

/** The code lines that are not part of an import statement. */
const nonImportCode = (code: string): string => code.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "");

const moduleSources = filesUnder(MODULE_DIR, isSource);

describe("E1.6a advisories containment (ADR 0137)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(WRITE_SQL.test("INSERT INTO bms.x")).toBe(true);
    expect(WRITE_SQL.test("ON CONFLICT DO UPDATE SET")).toBe(true);
    expect(WRITE_SQL.test("SELECT updated_at FROM bms.x")).toBe(false);
    expect(ML_TABLE.test("FROM ml.anomaly_scores s")).toBe(true);
    expect(ML_TABLE.test("JOIN ml.model_runs r")).toBe(true);
    expect(ML_TABLE.test("readAnomalies")).toBe(false);
    expect(THRESHOLD_LITERAL.test("ratio >= 1.5")).toBe(true);
    expect(THRESHOLD_LITERAL.test("pf / 0.99")).toBe(true);
    expect(THRESHOLD_LITERAL.test("value 0.995 or 11.5 or 1.55")).toBe(false);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../notifications/notifications.service";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../llm";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../ml/ml-anomalies.service";')).toBe(false);
    expect(nonImportCode('import { A } from "x";\nconst a = 1.5;')).not.toContain("import");
    expect(normalise("a  b\n  c")).toBe("a b c");
    expect(codeOnly("/* INSERT */ x\n// DELETE\ny")).not.toMatch(WRITE_SQL);
  });

  it("the scan finds the module's sources", () => {
    expect(moduleSources).toEqual(
      expect.arrayContaining([
        CONTROLLER_REL,
        READS_REL,
        `${MODULE_DIR}/advisories.service.ts`,
        `${MODULE_DIR}/advisories.module.ts`,
        `${MODULE_DIR}/advisory-power-factor.ts`,
        `${MODULE_DIR}/advisory-consumption.ts`,
      ]),
    );
    expect(moduleSources.some((rel) => rel.includes(".spec.") || rel.includes(".fixture."))).toBe(false);
  });

  it("the controller is guarded and declares exactly the two routes", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    expect(code).toMatch(/@UseGuards\(JwtAuthGuard\)\s*export class AdvisoriesController\b/);
    expect([...code.matchAll(ROUTE_DECORATOR)]).toHaveLength(2);
    expect(code).toContain('@Get("advisories")');
    expect(code).toContain('@Get("assets/:assetId/advisories")');
  });

  it("list parses, then narrows, then reads; forAsset checks canReadAsset before it reads", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    const list = methodBody(code, "list");
    const parse = list.indexOf("advisoriesQuerySchema.safeParse(");
    const narrow = list.indexOf("this.assetFilterScope.narrow(");
    const service = list.indexOf("this.advisories.list(");
    expect(parse).toBeGreaterThanOrEqual(0);
    expect(narrow).toBeGreaterThan(parse);
    expect(service).toBeGreaterThan(narrow);
    const forAsset = methodBody(code, "forAsset");
    const idCheck = forAsset.indexOf("assertAssetIdParam(");
    const canRead = forAsset.indexOf("this.accessControl.canReadAsset(");
    const reads = forAsset.indexOf("this.advisories.forAsset(");
    expect(idCheck).toBeGreaterThanOrEqual(0);
    expect(canRead).toBeGreaterThan(idCheck);
    expect(reads).toBeGreaterThan(canRead);
  });

  it("no source writes, or names the ml tables", () => {
    for (const rel of moduleSources) {
      const code = codeOnly(read(rel));
      expect(WRITE_SQL.exec(code)?.[0], `${rel} writes`).toBeUndefined();
      expect(ML_TABLE.exec(code)?.[0], `${rel} names an ml table`).toBeUndefined();
    }
  });

  it("no source restates 1.5 or 0.99 outside an import: the constants are imported", () => {
    for (const rel of moduleSources) {
      const code = nonImportCode(codeOnly(read(rel)));
      expect(THRESHOLD_LITERAL.exec(code)?.[0], `${rel} restates a threshold`).toBeUndefined();
    }
  });

  it("no source imports the LLM, the copilot, alarms, notifications, work orders or the queue", () => {
    for (const rel of moduleSources) {
      expect(FORBIDDEN_IMPORT.exec(read(rel))?.[0], `${rel} imports a forbidden module`).toBeUndefined();
    }
  });

  it("nothing in reports, notifications, work orders, alarms or the copilot names advisories", () => {
    const dirs = [
      "apps/api/src/reports",
      "apps/api/src/notifications",
      "apps/api/src/work-orders",
      "apps/api/src/alarms",
      "apps/api/src/copilot",
      "packages/shared/src/copilot",
    ];
    const all = dirs.flatMap((dir) => filesUnder(dir, (name) => /\.(ts|tsx)$/.test(name)));
    // Positive control: the walk reaches each tree.
    for (const dir of dirs) expect(all.some((rel) => rel.startsWith(`${dir}/`)), dir).toBe(true);
    for (const rel of all) {
      expect(NAMES_ADVISORIES.exec(read(rel))?.[0], `${rel} names advisories`).toBeUndefined();
    }
  });

  it("the candidate statement's real line is the ML scorer's own, whitespace normalised", () => {
    const python = REAL_LINE.exec(normalise(read(SQL_PY_REL)));
    expect(python?.[1], `the real line is missing from ${SQL_PY_REL}`).toBeDefined();
    const reads = normalise(codeOnly(read(READS_REL)));
    expect(reads).toContain(`AND ${python?.[1]}`);
    expect(reads).toContain("ap.point_key = 'kw'");
    // Negative control: a looser line is not the same text.
    expect(normalise("AND (a.meta->>'telemetrySource' = 'mqtt' OR r.ingest_enabled)")).not.toContain(python?.[1] ?? "x");
  });

  it("the template optimisation section is still refused", () => {
    const source = read(CONTENT_WRITES_REL);
    const block = /const RESERVED_SECTIONS[^=]*=\s*\{([\s\S]*?)\};/.exec(source);
    expect(block?.[1], "RESERVED_SECTIONS not found").toBeDefined();
    expect(block?.[1]).toMatch(/\boptimisation\s*:/);
  });
});
