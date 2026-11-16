import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE_DIR = "packages/db/drizzle";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The one migration file the glob names; throws on zero or two. */
const migrationFile = (): string => {
  const files = readdirSync(join(repoRoot, DRIZZLE_DIR)).filter((f) => /^\d{4}_ml_anomaly_read_grant\.sql$/.test(f));
  if (files.length !== 1) throw new Error(`expected one *_ml_anomaly_read_grant.sql, found ${files.length}`);
  return files[0] as string;
};

const migration = (): string => sqlOnly(read(`${DRIZZLE_DIR}/${migrationFile()}`));

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

const flat = (s: string): string => s.replace(/\s+/g, " ");

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-d — the static half of the grant migration
 * (`bms_tenant` reads `ml.anomaly_scores`). Plan
 * `docs/plans/e1.2-anomaly-detection.md` §7, T2.1.
 * `tests/e1.2b-ml-anomaly-read-grant.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("E1.2b — the ml anomaly read grant (static)", () => {
  it("is one file, not empty, found by its glob", () => {
    expect(migrationFile()).toMatch(/^\d{4}_ml_anomaly_read_grant\.sql$/);
    expect(migration().length).toBeGreaterThan(1000);
  });

  it("registers the migration in the journal right after the entry before it, above its when and not ahead of now", () => {
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
    expect(entry.when as number).toBeLessThan(Date.now() + 3_600_000);
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

  it("the only GRANT is SELECT on ml.anomaly_scores to bms_tenant, inside the bracket", () => {
    const grants = flat(statements()).match(/\bGRANT\b[^;]*;/g) ?? [];
    expect(grants).toEqual(["GRANT SELECT ON ml.anomaly_scores TO bms_tenant;"]);
    expect(flat(ownerBracket(statements()))).toContain(grants[0]);
  });

  it("re-issues the schema marker at version 3 inside the bracket, once", () => {
    expect(ownerBracket(statements())).toContain("COMMENT ON SCHEMA ml IS 'bms-ml-schema-version=3';");
    expect(statements().match(/COMMENT ON SCHEMA ml IS/g) ?? []).toHaveLength(1);
  });

  it("creates or alters no table, index or policy, and grants nothing wider (ALL, bms_auth)", () => {
    const sql = statements();
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP) (TABLE|INDEX|UNIQUE INDEX|POLICY|SCHEMA|ROLE)\b/);
    expect(sql).not.toMatch(/\bREVOKE\b/);
    expect(sql).not.toMatch(/statement-breakpoint/);
    for (const grant of flat(sql).match(/\bGRANT\b[^;]*;/g) ?? []) {
      expect(grant).not.toMatch(/\b(ALL|bms_auth|bms_fleet|bms_rollup|PUBLIC|INSERT|UPDATE|DELETE|TRUNCATE|OPTION)\b/);
    }
  });

  it("runs no DDL and no dynamic SQL inside the proof, so a grant cannot hide there", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof).not.toMatch(/\bEXECUTE\b/);
    expect(proof.replace(/'[^']*'/g, "''")).not.toMatch(/\b(GRANT|REVOKE|CREATE|ALTER|DROP)\b/);
    expect("x GRANT y 'GRANT'".replace(/'[^']*'/g, "''")).toMatch(/\bGRANT\b/);
  });

  it("closes with a proof that checks the marker, all three tables, the refusals, the column grants and the policies", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof.length, "the migration must end with a DO $$ proof").toBeGreaterThan(500);
    for (const needle of [
      "bms-ml-schema-version=3",
      "has_schema_privilege('bms_tenant', 'ml', 'USAGE')",
      "has_schema_privilege('bms_tenant', 'ml', 'CREATE')",
      "has_any_column_privilege",
      "SELECT WITH GRANT OPTION",
      "'model_runs', 'forecasts', 'anomaly_scores'",
      "relforcerowsecurity",
      "tenant_isolation",
      "bms_auth",
      "bms_fleet",
      "REFERENCES",
      "TRIGGER",
      "TRUNCATE",
    ]) {
      expect(proof, needle).toContain(needle);
    }
  });
});
