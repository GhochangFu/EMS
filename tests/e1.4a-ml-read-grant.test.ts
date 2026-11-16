import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE_DIR = "packages/db/drizzle";
const MIRROR_REL = "packages/db/src/schema/ml-schema.ts";
const ML_SCHEMA_REL = `${DRIZZLE_DIR}/0157_ml_schema.sql`;

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** Strip block and line comments from TypeScript (the f3.1a lesson). */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** The one migration file the glob names; throws on zero or two. */
const migrationFile = (): string => {
  const files = readdirSync(join(repoRoot, DRIZZLE_DIR)).filter((f) => /^\d{4}_ml_tenant_read_grant\.sql$/.test(f));
  if (files.length !== 1) throw new Error(`expected one *_ml_tenant_read_grant.sql, found ${files.length}`);
  return files[0] as string;
};

const migration = (): string => sqlOnly(read(`${DRIZZLE_DIR}/${migrationFile()}`));
const flat = (): string => migration().replace(/\s+/g, " ");

/** Everything before the closing proof, so the proof's own text never satisfies a statement check. */
const statements = (): string => {
  const sql = migration();
  const proof = sql.indexOf("DO $$");
  return proof < 0 ? sql : sql.slice(0, proof);
};

const ownerBracket = (sql: string): string => {
  const start = sql.indexOf("SET ROLE bms_owner;");
  const end = sql.indexOf("RESET ROLE;", start);
  if (start < 0 || end < 0) throw new Error("no SET ROLE bms_owner / RESET ROLE bracket");
  return sql.slice(start, end);
};

/**
 * `E1.4a` / ADR 0135 Amendment 3 ruling 2, R-a, R-b and S5 — the static half
 * of the grant migration (`bms_tenant` reads `ml.forecasts` and
 * `ml.model_runs`) and of the `ml` Drizzle mirror. Plan
 * `docs/plans/e1.4-forecast-read-path.md` §5, T1.1.
 * `tests/e1.4a-ml-read-grant.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("E1.4a — the ml read grant (static)", () => {
  it("is one file, not empty, found by its glob", () => {
    expect(migrationFile()).toMatch(/^\d{4}_ml_tenant_read_grant\.sql$/);
    expect(migration().length).toBeGreaterThan(1000);
  });

  it("registers the migration in the journal right after the entry before it, above its when and before now", () => {
    const journal = JSON.parse(read(`${DRIZZLE_DIR}/meta/_journal.json`)) as {
      entries: Array<Record<string, unknown>>;
    };
    const tag = migrationFile().replace(/\.sql$/, "");
    const index = journal.entries.findIndex((e) => e.tag === tag);
    expect(index, `${tag} must have a journal entry, or drizzle never runs it`).toBeGreaterThan(0);
    const entry = journal.entries[index] as Record<string, unknown>;
    const previous = journal.entries[index - 1] as Record<string, unknown>;
    expect(entry.version).toBe("7");
    expect(entry.breakpoints).toBe(true);
    expect(entry.idx).toBe((previous.idx as number) + 1);
    expect(entry.when as number).toBeGreaterThan(previous.when as number);
    expect(entry.when as number).toBeLessThan(Date.now());
    // The file's number is the tag's, and it follows the previous tag's number.
    expect(Number(tag.slice(0, 4))).toBe(Number(String(previous.tag).slice(0, 4)) + 1);
  });

  it("runs one SET ROLE bms_owner / RESET ROLE bracket, after lock_timeout", () => {
    const sql = statements();
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    const lock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.indexOf("SET ROLE bms_owner;"));
  });

  it("grants exactly USAGE on ml and SELECT on forecasts and model_runs to bms_tenant, inside the bracket", () => {
    // The statements before the proof; the proof itself may run no DDL (asserted below).
    const grants = statements().replace(/\s+/g, " ").match(/\bGRANT\b[^;]*;/g) ?? [];
    expect(grants).toEqual([
      "GRANT USAGE ON SCHEMA ml TO bms_tenant;",
      "GRANT SELECT ON ml.forecasts, ml.model_runs TO bms_tenant;",
    ]);
    const owner = ownerBracket(statements());
    for (const grant of grants) expect(owner.replace(/\s+/g, " ")).toContain(grant);
  });

  it("re-issues the schema marker at version 2 inside the bracket (Amendment 3 R-b)", () => {
    const owner = ownerBracket(statements());
    expect(owner).toContain("COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=2';");
    expect(statements().match(/COMMENT ON SCHEMA ml IS/g) ?? []).toHaveLength(1);
  });

  it("creates or alters no table, index or policy, and grants nothing wider (ALL, bms_auth, anomaly_scores)", () => {
    const sql = statements();
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP) (TABLE|INDEX|UNIQUE INDEX|POLICY|SCHEMA|ROLE)\b/);
    expect(sql).not.toMatch(/\bREVOKE\b/);
    expect(sql, "anomaly_scores is E1.2's; it may appear only in the proof").not.toContain("anomaly_scores");
    for (const grant of statements().replace(/\s+/g, " ").match(/\bGRANT\b[^;]*;/g) ?? []) {
      expect(grant).not.toMatch(/\b(ALL|bms_auth|bms_fleet|bms_rollup|PUBLIC|INSERT|UPDATE|DELETE|TRUNCATE|OPTION)\b/);
    }
  });

  it("runs no DDL and no dynamic SQL inside the proof, so a grant cannot hide there", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof).not.toMatch(/\bEXECUTE\b/);
    expect(proof.replace(/'[^']*'/g, "''")).not.toMatch(/\b(GRANT|REVOKE|CREATE|ALTER|DROP)\b/);
    // Positive control: the string-stripping leaves a real keyword visible.
    expect("x GRANT y 'GRANT'".replace(/'[^']*'/g, "''")).toMatch(/\bGRANT\b/);
  });

  it("closes with a proof block that checks the marker, the grants, the refusals, the column grants and the policies", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof.length, "the migration must end with a DO $$ proof").toBeGreaterThan(500);
    for (const needle of [
      "bms-ml-schema-version=2",
      "has_schema_privilege('bms_tenant', 'ml', 'USAGE')",
      "has_schema_privilege('bms_tenant', 'ml', 'CREATE')",
      "has_any_column_privilege",
      "relforcerowsecurity",
      "tenant_isolation",
      "anomaly_scores",
      "bms_auth",
      "bms_fleet",
      "REFERENCES",
      "TRIGGER",
    ]) {
      expect(proof, needle).toContain(needle);
    }
  });
});

describe("E1.4a — the ml Drizzle mirror (static, Amendment 3 R-a)", () => {
  it("drizzle.config.ts schemaFilter is exactly bms, telemetry, ml", () => {
    const config = codeOnly(read("packages/db/drizzle.config.ts"));
    expect(config).toMatch(/schemaFilter:\s*\[\s*"bms",\s*"telemetry",\s*"ml"\s*\]/);
  });

  it("declares pgSchema(\"ml\") and the three tables, and schema/index.ts exports it", () => {
    expect(existsSync(join(repoRoot, MIRROR_REL))).toBe(true);
    const mirror = codeOnly(read(MIRROR_REL));
    expect(mirror).toMatch(/pgSchema\("ml"\)/);
    for (const table of ["model_runs", "forecasts", "anomaly_scores"]) {
      expect(mirror, table).toMatch(new RegExp(`mlSchema\\.table\\(\\s*"${table}"`));
    }
    expect(codeOnly(read("packages/db/src/schema/index.ts"))).toMatch(/^export \* from "\.\/ml-schema";$/m);
  });

  it("names every constraint and index 0157's proof lists, by the same names (N5: less the bms.assets key)", () => {
    const proofSource = sqlOnly(read(ML_SCHEMA_REL));
    const named = [...proofSource.matchAll(/ARRAY\['([a-z_]+)', '(?:ml|bms)\.[a-z_]+'\]/g)].map((m) => m[1] as string);
    // Positive control: the extractor reads 0157's list, all twenty names of it.
    expect(named).toContain("forecasts_pkey");
    expect(named).toContain("anomaly_scores_model_run_idx");
    expect(named).toHaveLength(20);
    const mirror = codeOnly(read(MIRROR_REL));
    for (const name of named.filter((n) => n !== "assets_id_organization_id_key")) {
      expect(mirror, name).toContain(`"${name}"`);
    }
  });
});
