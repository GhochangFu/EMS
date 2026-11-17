import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE_DIR = "packages/db/drizzle";
const MIRROR_REL = "packages/db/src/schema/ml-findings-schema.ts";
const FORCED_REL = "apps/api/src/database/bms-owner-rls.integration.spec.ts";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The one migration file the glob names; throws on zero or two. */
const migrationFile = (): string => {
  const files = readdirSync(join(repoRoot, DRIZZLE_DIR)).filter((f) => /^\d{4}_ml_finding_paragraphs\.sql$/.test(f));
  if (files.length !== 1) throw new Error(`expected one *_ml_finding_paragraphs.sql, found ${files.length}`);
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

/** The column names of the `CREATE TABLE` body: each line that starts with a lower-case name and a type. */
const sqlColumns = (sql: string): string[] => {
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS bms.ml_finding_paragraphs (");
  if (start < 0) throw new Error("no CREATE TABLE IF NOT EXISTS bms.ml_finding_paragraphs");
  const body = sql.slice(start, sql.indexOf("\n);", start));
  return [...body.matchAll(/^\s{2}([a-z_]+) (uuid|varchar|text|smallint|timestamptz)\b/gm)].map((m) => m[1] as string);
};

/** The snake_case names the Drizzle mirror declares (`uuid("organization_id")`, …). */
const mirrorColumns = (source: string): string[] =>
  [...source.matchAll(/\b(?:uuid|varchar|text|smallint|timestamp)\("([a-z_]+)"/g)].map((m) => m[1] as string);

const CONSTRAINTS = [
  "ml_finding_paragraphs_org_kind_hash_key",
  "ml_finding_paragraphs_kind_check",
  "ml_finding_paragraphs_status_check",
  "ml_finding_paragraphs_facts_hash_check",
  "ml_finding_paragraphs_paragraph_check",
  "ml_finding_paragraphs_reason_check",
  "ml_finding_paragraphs_attempts_check",
];

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 7 (plan T3.1; owner ruling Q3 (a)) —
 * the static half of migration `0162` (`bms.ml_finding_paragraphs`).
 * `tests/e1.9c-ml-finding-paragraphs-schema.integration.test.ts` asserts what
 * Postgres enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("E1.9c — bms.ml_finding_paragraphs (static)", () => {
  it("the helpers see what they are meant to (positive controls)", () => {
    expect(sqlColumns("CREATE TABLE IF NOT EXISTS bms.ml_finding_paragraphs (\n  id uuid PRIMARY KEY,\n  CONSTRAINT x CHECK (y)\n);")).toEqual(["id"]);
    expect(mirrorColumns('a: uuid("organization_id"), b: smallint("attempts")')).toEqual(["organization_id", "attempts"]);
    expect(sqlOnly("-- GRANT UPDATE\nSELECT 1;")).toBe("SELECT 1;");
  });

  it("is one file, not empty, found by its glob, and number 0162", () => {
    expect(migrationFile()).toBe("0162_ml_finding_paragraphs.sql");
    expect(migration().length).toBeGreaterThan(2000);
  });

  it("is the journal's last entry, one above the entry before it, above its when and not ahead of now", () => {
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
    expect(previous.tag).toBe("0161_anomaly_widget_type");
  });

  it("runs one SET ROLE bms_owner / RESET ROLE bracket, after lock_timeout, with no breakpoint markers", () => {
    const sql = statements();
    expect(sql.match(/SET ROLE bms_owner;/g) ?? []).toHaveLength(1);
    expect(sql.match(/RESET ROLE;/g) ?? []).toHaveLength(1);
    const lock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(sql.indexOf("SET ROLE bms_owner;"));
    expect(migration()).not.toMatch(/statement-breakpoint/);
  });

  it("creates the table, ENABLEs and FORCEs row security and the strict policy, inside the bracket", () => {
    const bracket = flat(ownerBracket(statements()));
    expect(bracket).toContain("CREATE TABLE IF NOT EXISTS bms.ml_finding_paragraphs (");
    expect(bracket).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id) ON DELETE CASCADE");
    expect(bracket).toContain("facts_hash varchar(64) NOT NULL");
    expect(bracket).toContain("attempts smallint NOT NULL DEFAULT 1");
    expect(bracket).toContain("ALTER TABLE bms.ml_finding_paragraphs ENABLE ROW LEVEL SECURITY;");
    expect(bracket).toContain("ALTER TABLE bms.ml_finding_paragraphs FORCE ROW LEVEL SECURITY;");
    expect(bracket).toContain("DROP POLICY IF EXISTS tenant_isolation ON bms.ml_finding_paragraphs;");
    expect(bracket).toContain(
      "CREATE POLICY tenant_isolation ON bms.ml_finding_paragraphs " +
        "USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid) " +
        "WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);",
    );
    const policy = flat(statements()).match(/CREATE POLICY [^;]*;/g) ?? [];
    expect(policy).toHaveLength(1);
    expect(policy[0]).not.toMatch(/IS NULL|\bOR\b/i);
  });

  it("names every constraint, with the hash shape, the text rule and attempts >= 1", () => {
    const sql = flat(statements());
    for (const name of CONSTRAINTS) expect(sql, name).toContain(`CONSTRAINT ${name} `);
    expect(sql).toContain("CHECK (facts_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).toContain("CHECK (kind IN ('forecasts', 'anomalies'))");
    expect(sql).toContain("CHECK (status IN ('ok', 'rejected', 'failed'))");
    expect(sql).toContain("(status = 'ok') = (paragraph IS NOT NULL)");
    expect(sql).toContain("char_length(paragraph) BETWEEN 1 AND 600");
    expect(sql).toContain("CHECK ((status = 'ok') = (reason IS NULL))");
    expect(sql).toContain("CHECK (attempts >= 1)");
    expect(sql).toContain("UNIQUE (organization_id, kind, facts_hash)");
  });

  it("grants nothing, and revokes UPDATE from bms_tenant and every write from bms_fleet", () => {
    const sql = flat(statements());
    expect(sql).not.toMatch(/\bGRANT\b/);
    expect(sql.match(/\bREVOKE\b[^;]*;/g) ?? []).toEqual([
      "REVOKE UPDATE ON bms.ml_finding_paragraphs FROM bms_tenant;",
      "REVOKE INSERT, UPDATE, DELETE ON bms.ml_finding_paragraphs FROM bms_fleet;",
    ]);
    const bracket = flat(ownerBracket(statements()));
    expect(bracket).toContain("REVOKE UPDATE ON bms.ml_finding_paragraphs FROM bms_tenant;");
    expect(bracket).toContain("REVOKE INSERT, UPDATE, DELETE ON bms.ml_finding_paragraphs FROM bms_fleet;");
  });

  it("touches nothing in schema ml and no schema comment (the marker stays version 3)", () => {
    const sql = statements();
    expect(sql).not.toMatch(/\bml\./);
    expect(sql).not.toMatch(/COMMENT ON SCHEMA/);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP) (INDEX|UNIQUE INDEX|SCHEMA|ROLE)\b/);
  });

  it("runs no DDL and no dynamic SQL inside the proof", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof).not.toMatch(/\bEXECUTE\b/);
    expect(proof.replace(/'[^']*'/g, "''")).not.toMatch(/\b(GRANT|REVOKE|CREATE|ALTER|DROP)\b/);
  });

  it("closes with a proof of row security, the one strict policy, each role's grants and every constraint", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof.length).toBeGreaterThan(1500);
    for (const needle of [
      "c.relrowsecurity AND c.relforcerowsecurity",
      "qual NOT LIKE '%IS NULL%'",
      "with_check NOT LIKE '%IS NULL%'",
      "qual !~* '\\mor\\M'",
      "policies <> 1",
      "ARRAY['SELECT', 'INSERT', 'DELETE']",
      "' WITH GRANT OPTION'",
      "ARRAY['UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']",
      "has_any_column_privilege('bms_tenant', 'bms.ml_finding_paragraphs', 'UPDATE')",
      "has_table_privilege('bms_fleet', 'bms.ml_finding_paragraphs', 'SELECT')",
      "ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']",
      "has_any_column_privilege('bms_fleet', 'bms.ml_finding_paragraphs', verb)",
      "has_table_privilege('bms_auth', 'bms.ml_finding_paragraphs', verb)",
      "has_any_column_privilege('bms_auth', 'bms.ml_finding_paragraphs', verb)",
    ]) {
      expect(proof, needle).toContain(needle);
    }
    for (const name of CONSTRAINTS) expect(proof, name).toContain(`'${name}'`);
  });

  it("the Drizzle mirror declares exactly the SQL's columns, on bmsSchema, and is exported", () => {
    const mirror = read(MIRROR_REL);
    expect(mirror).toContain('bmsSchema.table(\n  "ml_finding_paragraphs"');
    expect(mirrorColumns(mirror)).toEqual(sqlColumns(statements()));
    expect(sqlColumns(statements())).toEqual([
      "id",
      "organization_id",
      "kind",
      "facts_hash",
      "status",
      "paragraph",
      "reason",
      "provider",
      "model",
      "attempts",
      "created_at",
    ]);
    expect(mirror).toContain('unique("ml_finding_paragraphs_org_kind_hash_key")');
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./ml-findings-schema";');
  });

  it("the table joins FORCED_TABLES in the owner-RLS spec", () => {
    expect(read(FORCED_REL)).toMatch(/^\s+"ml_finding_paragraphs",$/m);
  });
});
