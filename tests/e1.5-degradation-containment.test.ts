import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEGRADATION_DRIFT_TARGETS } from "../packages/shared/src/contracts/degradation.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * `E1.5a` / ADR 0138 (plan T1.7, R-j, R-k, R-q) — what only a scan of
 * `apps/api/src/degradation/` can hold. Assertions are inline (this is the
 * top-level `tests/` directory, AGENTS.md §4.6).
 *
 * - The two routes sit behind `JwtAuthGuard`; `list` parses, then narrows, then
 *   reads; `forAsset` checks the id, then `canReadAsset`, before it reads.
 * - The module writes nothing and never names an `ml.` table.
 * - Advisory only: no import of the LLM, the copilot, alarms, notifications,
 *   work orders, maintenance, reports or the queue, and none of those names
 *   degradation in code (comments are prose: several explain an unrelated
 *   "degradation" of a retry or a queue, so they are stripped first).
 * - "Real" is the ML scorer's own line, held equal to `apps/ml`'s text.
 * - The drift targets are the scorer's two default lists (R-j).
 * - No screen or contract says "remaining useful life" or "RUL".
 * - The figures 28, 21, 90, 0.05 and the band code "fair" are imported from the
 *   contract, never restated in a module source; no other band code is named either.
 */
const MODULE_DIR = "apps/api/src/degradation";
const CONTROLLER_REL = `${MODULE_DIR}/degradation.controller.ts`;
const READS_REL = `${MODULE_DIR}/degradation.reads.ts`;
const SQL_PY_REL = "apps/ml/src/bms_ml/db/sql.py";
const TARGETS_PY_REL = "apps/ml/src/bms_ml/targets.py";
const CONTRACT_REL = "packages/shared/src/contracts/degradation.ts";

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

const ROUTE_DECORATOR = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/g;
const WRITE_SQL = /\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/;
const ML_TABLE = /\bml\.[a-z_]+/;
const FORBIDDEN_IMPORT =
  /from\s+["']\.\.\/(llm|copilot|alarms|notifications|work-orders|maintenance|reports|queue)(\/[^"']*)?["']/;
const NAMES_DEGRADATION = /degradation/i;
const NAMES_RUL = /remaining useful life|\bRUL\b/i;
/**
 * A restated figure (28, 21, 90 or 0.05, not part of a longer number), or a band code of the
 * standard set as a string: the limit band is `DEGRADATION_HEALTH_LIMIT_BAND`, and bands are data
 * (R-i), so no module source names one — "fair" or any other.
 */
const RESTATED_LITERAL = /(?<![\w.])(28|21|90|0\.05)(?![\w.])|["'`](excellent|good|fair|poor|critical)["'`]/;
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

/** `targets.py`'s classes: every `Target("…", "…", "…")` and every key of the `*_energy_meter(…)` call. */
const pythonTargets = (source: string): string[] => {
  const out = [...source.matchAll(/Target\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\s*\)/g)].map((m) => `${m[1]}/${m[2]}/${m[3]}`);
  for (const call of source.matchAll(/\*_energy_meter\(([\s\S]*?)\)/g)) {
    for (const key of call[1]!.matchAll(/"([^"]+)"/g)) out.push(`electrical/energy_meter/${key[1]}`);
  }
  return out;
};

const moduleSources = filesUnder(MODULE_DIR, isSource);

describe("E1.5a degradation containment (ADR 0138)", () => {
  it("the patterns match what they are meant to (positive controls)", () => {
    expect(WRITE_SQL.test("INSERT INTO bms.x")).toBe(true);
    expect(WRITE_SQL.test("ON CONFLICT DO UPDATE SET")).toBe(true);
    expect(WRITE_SQL.test("SELECT updated_at FROM bms.x")).toBe(false);
    expect(ML_TABLE.test("FROM ml.anomaly_scores s")).toBe(true);
    expect(ML_TABLE.test("JOIN ml.model_runs r")).toBe(true);
    expect(ML_TABLE.test('from "../ml/ml-findings.reads"')).toBe(false);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../maintenance/maintenance.service";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../reports";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../work-orders/work-orders.service";')).toBe(true);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../maintenance-windows/x";')).toBe(false);
    expect(FORBIDDEN_IMPORT.test('import { X } from "../asset-health/asset-health.service";')).toBe(false);
    expect(NAMES_DEGRADATION.test('import { DegradationService } from "../degradation/degradation.service";')).toBe(true);
    expect(NAMES_RUL.test("Remaining useful life: 12 days")).toBe(true);
    expect(NAMES_RUL.test("RUL 12")).toBe(true);
    expect(NAMES_RUL.test("const RULE = 1; rules")).toBe(false);
    expect(RESTATED_LITERAL.test("n >= 21")).toBe(true);
    expect(RESTATED_LITERAL.test("days: 28")).toBe(true);
    expect(RESTATED_LITERAL.test("point > 90")).toBe(true);
    expect(RESTATED_LITERAL.test("p < 0.05")).toBe(true);
    expect(RESTATED_LITERAL.test('band.code === "fair"')).toBe(true);
    expect(RESTATED_LITERAL.test("band.code === 'good'")).toBe(true);
    expect(RESTATED_LITERAL.test("0.9 * 100, 86_400_000, 1.28, 210, 0.055, fairLabel")).toBe(false);
    expect(nonImportCode('import { A } from "x";\nconst a = 21;')).not.toContain("import");
    expect(normalise("a  b\n  c")).toBe("a b c");
    expect(codeOnly("/* INSERT */ x\n// DELETE\ny")).not.toMatch(WRITE_SQL);
    expect(pythonTargets('Target("a", "b", "c")\n*_energy_meter(\n "kw",\n "pf",\n)')).toEqual([
      "a/b/c",
      "electrical/energy_meter/kw",
      "electrical/energy_meter/pf",
    ]);
  });

  it("the scan finds the module's sources and leaves out specs and fixtures", () => {
    expect(moduleSources).toEqual(
      expect.arrayContaining([
        CONTROLLER_REL,
        READS_REL,
        `${MODULE_DIR}/degradation.service.ts`,
        `${MODULE_DIR}/degradation.module.ts`,
        `${MODULE_DIR}/degradation-health.ts`,
        `${MODULE_DIR}/degradation-lines.ts`,
        `${MODULE_DIR}/trend-math.ts`,
      ]),
    );
    expect(moduleSources.some((rel) => rel.includes(".spec.") || rel.includes(".test.") || rel.includes(".fixture."))).toBe(false);
  });

  it("the controller is guarded and declares exactly the two routes", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    expect(code).toMatch(/@UseGuards\(JwtAuthGuard\)\s*export class DegradationController\b/);
    expect([...code.matchAll(ROUTE_DECORATOR)]).toHaveLength(2);
    expect(code).toContain('@Get("degradation")');
    expect(code).toContain('@Get("assets/:assetId/degradation")');
  });

  it("list parses, then narrows, then reads; forAsset checks the id and canReadAsset before it reads", () => {
    const code = codeOnly(read(CONTROLLER_REL));
    const list = methodBody(code, "list");
    const parse = list.indexOf("degradationQuerySchema.safeParse(");
    const narrow = list.indexOf("this.assetFilterScope.narrow(");
    const service = list.indexOf("this.degradation.list(");
    expect(parse).toBeGreaterThanOrEqual(0);
    expect(narrow).toBeGreaterThan(parse);
    expect(service).toBeGreaterThan(narrow);
    const forAsset = methodBody(code, "forAsset");
    const idCheck = forAsset.indexOf("assertAssetIdParam(");
    const canRead = forAsset.indexOf("this.accessControl.canReadAsset(");
    const reads = forAsset.indexOf("this.degradation.forAsset(");
    expect(idCheck).toBeGreaterThanOrEqual(0);
    expect(canRead).toBeGreaterThan(idCheck);
    expect(reads).toBeGreaterThan(canRead);
  });

  it("no source writes, or names an ml table", () => {
    for (const rel of moduleSources) {
      const code = codeOnly(read(rel));
      expect(WRITE_SQL.exec(code)?.[0], `${rel} writes`).toBeUndefined();
      expect(ML_TABLE.exec(code)?.[0], `${rel} names an ml table`).toBeUndefined();
    }
  });

  it("no source imports the LLM, the copilot, alarms, notifications, work orders, maintenance, reports or the queue", () => {
    for (const rel of moduleSources) {
      expect(FORBIDDEN_IMPORT.exec(read(rel))?.[0], `${rel} imports a forbidden module`).toBeUndefined();
    }
  });

  it("nothing in reports, notifications, work orders, alarms, the copilot, maintenance or the queue names degradation in code", () => {
    const dirs = [
      "apps/api/src/reports",
      "apps/api/src/notifications",
      "apps/api/src/work-orders",
      "apps/api/src/alarms",
      "apps/api/src/copilot",
      "apps/api/src/maintenance",
      "apps/api/src/queue",
      "packages/shared/src/copilot",
    ];
    const all = dirs.flatMap((dir) => filesUnder(dir, (name) => /\.(ts|tsx)$/.test(name)));
    // Positive control: the walk reaches each tree.
    for (const dir of dirs) expect(all.some((rel) => rel.startsWith(`${dir}/`)), dir).toBe(true);
    for (const rel of all) {
      expect(NAMES_DEGRADATION.exec(codeOnly(read(rel)))?.[0], `${rel} names degradation`).toBeUndefined();
    }
  });

  it("the candidate statement's real line is the ML scorer's own, whitespace normalised, on the asset and on each drift point", () => {
    const python = REAL_LINE.exec(normalise(read(SQL_PY_REL)));
    expect(python?.[1], `the real line is missing from ${SQL_PY_REL}`).toBeDefined();
    const reads = normalise(codeOnly(read(READS_REL)));
    expect(reads.split(`AND ${python?.[1]}`)).toHaveLength(3);
    // Negative control: a looser line is not the same text.
    expect(normalise("AND (a.meta->>'telemetrySource' = 'mqtt' OR r.ingest_enabled)")).not.toContain(python?.[1] ?? "x");
  });

  it("DEGRADATION_DRIFT_TARGETS is the scorer's two default target lists (R-j)", () => {
    const python = pythonTargets(read(TARGETS_PY_REL));
    // Positive control: the parse reaches both lists (2 forecast + 22 anomaly entries, one shared class twice).
    expect(python.length).toBeGreaterThanOrEqual(23);
    const typescript = DEGRADATION_DRIFT_TARGETS.map((t) => `${t.domain}/${t.assetType}/${t.pointKey}`);
    expect(new Set(typescript).size).toBe(typescript.length);
    expect([...new Set(typescript)].sort()).toEqual([...new Set(python)].sort());
    expect(typescript).not.toContain("electrical/energy_meter/kwh_total");
  });

  it("no web source and no line of the contract says remaining useful life or RUL", () => {
    const web = filesUnder("apps/web/src", isSource);
    expect(web.length).toBeGreaterThan(0);
    for (const rel of [...web, CONTRACT_REL]) {
      expect(NAMES_RUL.exec(codeOnly(read(rel)))?.[0], `${rel} says RUL`).toBeUndefined();
    }
  });

  it("no module source restates 28, 21, 90, 0.05 or a band code (\"fair\" or any other) outside an import", () => {
    for (const rel of moduleSources) {
      const code = nonImportCode(codeOnly(read(rel)));
      expect(RESTATED_LITERAL.exec(code)?.[0], `${rel} restates a figure`).toBeUndefined();
    }
  });
});
