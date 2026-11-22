import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MODBUS_REGISTERS_MAX } from "../packages/shared/src/ingest-modbus";
import { POLL_INTERVAL_MAX_MS, POLL_INTERVAL_MIN_MS } from "../packages/shared/src/ingest-poll-interval";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const DRIZZLE_DIR = "packages/db/drizzle";
const MIRROR_REL = "packages/db/src/schema/device-profiles-schema.ts";
const ORGANIZATIONS_REL = "packages/db/src/schema/bms-schema.ts";
const FORCED_REL = "apps/api/src/database/bms-owner-rls.integration.spec.ts";

/** Strip `--` comment lines before a scan (the f3.67 lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The one migration file the glob names; throws on zero or two. */
const migrationFile = (): string => {
  const files = readdirSync(join(repoRoot, DRIZZLE_DIR)).filter((f) =>
    /^\d{4}_device_profiles_and_poll_interval\.sql$/.test(f),
  );
  if (files.length !== 1) throw new Error(`expected one *_device_profiles_and_poll_interval.sql, found ${files.length}`);
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
  const start = sql.indexOf("CREATE TABLE IF NOT EXISTS bms.device_profiles (");
  if (start < 0) throw new Error("no CREATE TABLE IF NOT EXISTS bms.device_profiles");
  const body = sql.slice(start, sql.indexOf("\n);", start));
  return [...body.matchAll(/^\s{2}([a-z_]+) (uuid|varchar|integer|jsonb|boolean|timestamptz)\b/gm)].map(
    (m) => m[1] as string,
  );
};

/** The snake_case names the Drizzle mirror declares (`uuid("organization_id")`, …). */
const mirrorColumns = (source: string): string[] =>
  [...source.matchAll(/\b(?:uuid|varchar|integer|jsonb|boolean|timestamp)\("([a-z_]+)"/g)].map((m) => m[1] as string);

const CONSTRAINTS = [
  "device_profiles_org_protocol_code_version_key",
  "device_profiles_id_org_key",
  "device_profiles_protocol_check",
  "device_profiles_code_check",
  "device_profiles_version_check",
  "device_profiles_source_check",
  "device_profiles_registers_check",
  "device_profiles_stock_check",
];

/**
 * `F1.2` / ADR 0141 decisions 10, 12, 13 (plan T2.1) — the static half of
 * migration `0164` (`bms.device_profiles`, `bms.organizations.default_poll_interval_ms`).
 * `tests/f1.2-device-profiles-schema.integration.test.ts` asserts what Postgres
 * enforces. Assertions inline (§4.6, top-level `tests/`).
 */
describe("F1.2 — bms.device_profiles and the organization poll interval (static)", () => {
  it("the helpers see what they are meant to (positive controls)", () => {
    expect(
      sqlColumns("CREATE TABLE IF NOT EXISTS bms.device_profiles (\n  id uuid PRIMARY KEY,\n  CONSTRAINT x CHECK (y)\n);"),
    ).toEqual(["id"]);
    expect(mirrorColumns('a: uuid("organization_id"), b: jsonb("registers")')).toEqual(["organization_id", "registers"]);
    expect(sqlOnly("-- GRANT UPDATE\nSELECT 1;")).toBe("SELECT 1;");
  });

  it("is one file, not empty, found by its glob, and number 0164", () => {
    expect(migrationFile()).toBe("0164_device_profiles_and_poll_interval.sql");
    expect(migration().length).toBeGreaterThan(2000);
  });

  // "Follows 0163" stands in for "is last": a later migration will follow this one.
  it("follows 0163 in the journal, one above it, after its when and not ahead of now", () => {
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
    expect(entry.when as number).toBeLessThanOrEqual(Date.now());
    expect(Number(tag.slice(0, 4))).toBe(Number(String(previous.tag).slice(0, 4)) + 1);
    expect(previous.tag).toBe("0163_ml_findings_widget_type");
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

  it("adds the nullable organization column and its CHECK at the shared interval bounds, inside the bracket", () => {
    const bracket = flat(ownerBracket(statements()));
    expect(bracket).toContain(
      "ALTER TABLE bms.organizations ADD COLUMN IF NOT EXISTS default_poll_interval_ms integer;",
    );
    expect(bracket).toContain(
      "ALTER TABLE bms.organizations DROP CONSTRAINT IF EXISTS organizations_default_poll_interval_ms_check;",
    );
    const check = bracket.match(
      /ADD CONSTRAINT organizations_default_poll_interval_ms_check CHECK \(default_poll_interval_ms BETWEEN (\d+) AND (\d+)\);/,
    );
    expect(check, "the organizations CHECK is missing or reshaped").not.toBeNull();
    expect(Number(check?.[1])).toBe(POLL_INTERVAL_MIN_MS);
    expect(Number(check?.[2])).toBe(POLL_INTERVAL_MAX_MS);
    // No backfill, no default: NULL means "no organization default".
    expect(statements()).not.toMatch(/UPDATE bms\.organizations/);
    expect(bracket).not.toMatch(/default_poll_interval_ms integer (NOT NULL|DEFAULT)/);
  });

  it("creates the table, ENABLEs and FORCEs row security and the strict policy, inside the bracket", () => {
    const bracket = flat(ownerBracket(statements()));
    expect(bracket).toContain("CREATE TABLE IF NOT EXISTS bms.device_profiles (");
    // Every column line in full, so a dropped NOT NULL is seen: each CHECK and
    // the unique key pass on NULL.
    for (const line of [
      "id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
      "organization_id uuid NOT NULL REFERENCES bms.organizations(id),",
      "protocol varchar(32) NOT NULL,",
      "code varchar(64) NOT NULL,",
      "version integer NOT NULL,",
      "vendor varchar(128) NOT NULL,",
      "model varchar(128) NOT NULL,",
      "source jsonb NOT NULL,",
      "verified boolean NOT NULL DEFAULT false,",
      "registers jsonb NOT NULL,",
      "stock_code varchar(64),",
      "stock_version integer,",
      "created_by uuid REFERENCES bms.users(id),",
      "created_at timestamptz NOT NULL DEFAULT now(),",
    ]) {
      expect(bracket, line).toContain(` ${line} `);
    }
    expect(bracket).toContain("ALTER TABLE bms.device_profiles ENABLE ROW LEVEL SECURITY;");
    expect(bracket).toContain("ALTER TABLE bms.device_profiles FORCE ROW LEVEL SECURITY;");
    expect(bracket).toContain("DROP POLICY IF EXISTS tenant_isolation ON bms.device_profiles;");
    expect(bracket).toContain(
      "CREATE POLICY tenant_isolation ON bms.device_profiles " +
        "USING (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid) " +
        "WITH CHECK (organization_id = nullif(current_setting('app.current_organization', true), '')::uuid);",
    );
    const policy = flat(statements()).match(/CREATE POLICY [^;]*;/g) ?? [];
    expect(policy).toHaveLength(1);
    expect(policy[0]).not.toMatch(/IS NULL|\bOR\b/i);
  });

  it("names every constraint, with the register bound equal to the shared constant", () => {
    const sql = flat(statements());
    for (const name of CONSTRAINTS) expect(sql, name).toContain(`CONSTRAINT ${name} `);
    expect(sql).toContain("UNIQUE (organization_id, protocol, code, version)");
    expect(sql).toContain("UNIQUE (id, organization_id)");
    expect(sql).toContain("CHECK (protocol = 'modbus_tcp')");
    expect(sql).toContain("CHECK (code ~ '^[A-Za-z0-9_-]+$')");
    expect(sql).toContain("CHECK (version >= 1)");
    expect(sql).toContain("CHECK (jsonb_typeof(source) = 'object')");
    const registers = sql.match(
      /CHECK \( jsonb_typeof\(registers\) = 'array' AND jsonb_array_length\(registers\) BETWEEN (\d+) AND (\d+) \)/,
    );
    expect(registers, "the registers CHECK is missing or reshaped").not.toBeNull();
    expect(Number(registers?.[1])).toBe(1);
    expect(Number(registers?.[2])).toBe(MODBUS_REGISTERS_MAX);
    expect(sql).toContain(
      "CHECK ( (stock_code IS NULL) = (stock_version IS NULL) AND (stock_version IS NULL OR stock_version >= 1) )",
    );
  });

  it("grants nothing, and revokes UPDATE and DELETE from bms_tenant and every write from bms_fleet (append-only, P2)", () => {
    const sql = flat(statements());
    expect(sql).not.toMatch(/\bGRANT\b/);
    expect(sql.match(/\bREVOKE\b[^;]*;/g) ?? []).toEqual([
      "REVOKE UPDATE, DELETE ON bms.device_profiles FROM bms_tenant;",
      "REVOKE INSERT, UPDATE, DELETE ON bms.device_profiles FROM bms_fleet;",
    ]);
    const bracket = flat(ownerBracket(statements()));
    expect(bracket).toContain("REVOKE UPDATE, DELETE ON bms.device_profiles FROM bms_tenant;");
    expect(bracket).toContain("REVOKE INSERT, UPDATE, DELETE ON bms.device_profiles FROM bms_fleet;");
  });

  it("no migration revokes 0041's default privileges for bms_owner in bms", () => {
    // The plan's T2.0 measure, in its static half: the default the "no GRANT"
    // above rests on is still the one 0041 set. The live half is the proof
    // block below (bms_tenant holds INSERT and SELECT) and the integration test.
    const offending = readdirSync(join(repoRoot, DRIZZLE_DIR))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /ALTER DEFAULT PRIVILEGES[^;]*\bREVOKE\b/i.test(flat(sqlOnly(read(`${DRIZZLE_DIR}/${f}`)))));
    expect(offending).toEqual([]);
    expect(flat(sqlOnly(read(`${DRIZZLE_DIR}/0041_bms_owner_and_force_rls.sql`)))).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN SCHEMA bms GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bms_tenant, bms_fleet;",
    );
  });

  it("runs no DDL and no dynamic SQL inside the proof", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof).not.toMatch(/\bEXECUTE\b/);
    expect(proof.replace(/'[^']*'/g, "''")).not.toMatch(/\b(GRANT|REVOKE|CREATE|ALTER|DROP)\b/);
  });

  it("closes with a proof of row security, the one strict policy, bms_tenant's grants, the column and every constraint", () => {
    const sql = migration();
    const proof = sql.slice(sql.indexOf("DO $$"));
    expect(proof.length).toBeGreaterThan(1500);
    for (const needle of [
      "c.relrowsecurity AND c.relforcerowsecurity",
      "qual NOT LIKE '%IS NULL%'",
      "with_check NOT LIKE '%IS NULL%'",
      "qual !~* '\\mor\\M'",
      "policies <> 1",
      "ARRAY['SELECT', 'INSERT']",
      "has_table_privilege('bms_tenant', 'bms.device_profiles', verb)",
      "ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']",
      "has_any_column_privilege('bms_tenant', 'bms.device_profiles', 'UPDATE')",
      "has_table_privilege('bms_fleet', 'bms.device_profiles', 'SELECT')",
      "ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']",
      "has_any_column_privilege('bms_fleet', 'bms.device_profiles', verb)",
      "has_table_privilege('bms_auth', 'bms.device_profiles', verb)",
      "attnotnull AND NOT attisdropped",
      "attname = 'default_poll_interval_ms'",
      "'organizations_default_poll_interval_ms_check'",
    ]) {
      expect(proof, needle).toContain(needle);
    }
    for (const name of CONSTRAINTS) expect(proof, name).toContain(`'${name}'`);
  });

  it("the Drizzle mirror declares the SQL's columns in order, with the same NOT NULLs, on bmsSchema, and is exported", () => {
    const mirror = read(MIRROR_REL);
    // A mirror column is NOT NULL when its declaration (up to the next column) says `.notNull()` or `.primaryKey()`.
    const declarations = mirror.split(/\n(?=\s{4}[a-zA-Z]+: )/).filter((d) => /\(\"[a-z_]+\"/.test(d));
    const mirrorNotNull = declarations
      .filter((d) => /\.notNull\(\)|\.primaryKey\(\)/.test(d))
      .map((d) => d.match(/\("([a-z_]+)"/)?.[1]);
    const body = flat(ownerBracket(statements()));
    const sqlNotNull = sqlColumns(statements()).filter((c) =>
      new RegExp(` ${c} [a-z]+(\\(\\d+\\))? (NOT NULL|PRIMARY KEY)`).test(body),
    );
    expect(mirrorNotNull).toEqual(sqlNotNull);
    expect(sqlNotNull.length, "no NOT NULL column found; the check is vacuous").toBeGreaterThan(5);
    expect(mirror).toContain('bmsSchema.table(\n  "device_profiles"');
    expect(mirrorColumns(mirror)).toEqual(sqlColumns(statements()));
    expect(sqlColumns(statements())).toEqual([
      "id",
      "organization_id",
      "protocol",
      "code",
      "version",
      "vendor",
      "model",
      "source",
      "verified",
      "registers",
      "stock_code",
      "stock_version",
      "created_by",
      "created_at",
    ]);
    for (const name of ["device_profiles_org_protocol_code_version_key", "device_profiles_id_org_key"]) {
      expect(mirror, name).toContain(`unique("${name}")`);
    }
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./device-profiles-schema";');
  });

  it("the organizations mirror declares default_poll_interval_ms as a nullable integer", () => {
    expect(read(ORGANIZATIONS_REL)).toMatch(/^\s+defaultPollIntervalMs: integer\("default_poll_interval_ms"\),$/m);
  });

  it("the table joins FORCED_TABLES in the owner-RLS spec", () => {
    expect(read(FORCED_REL)).toMatch(/^\s+"device_profiles",$/m);
  });
});
