import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.85` PR 6 / ADR 0099 decision 11 and Amendment 1 A1, A2 — migration `0106`
 * creates the copilot's two daily turn counters and adds
 * `bms.organizations.timezone`.
 *
 *   - `bms.copilot_usage`: one row per (user, day), `user_isolation` policy.
 *   - `bms.copilot_org_usage`: one row per (organization, day), strict
 *     `tenant_isolation` policy.
 *   - `organizations.timezone`: the IANA zone whose calendar date is the day
 *     key (A2). `NOT NULL DEFAULT 'UTC'`.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.21` model. What
 * Postgres enforces is `apps/api/src/copilot/copilot-usage.integration.spec.ts`
 * and `apps/api/src/database/bms-owner-rls.integration.spec.ts`; this file pins
 * the text, so a deleted `FORCE` or `REVOKE` is red here without a database.
 */
const MIGRATION_TAG = "0106_copilot_usage";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const COPILOT_SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
const BMS_SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0105_copilot_history";

const USER_PREDICATE = "user_id = nullif(current_setting('app.current_user', true), '')::uuid";
const TENANT_PREDICATE =
  "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion about a deleted statement. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One statement, from `start` to its `;`. */
const statementFrom = (sql: string, start: string): string => {
  const at = sql.indexOf(start);
  if (at < 0) throw new Error(`no "${start}" in the migration`);
  const end = sql.indexOf(";", at);
  return end < 0 ? sql.slice(at) : sql.slice(at, end + 1);
};

/** One drizzle table literal, from its declaration to the table's closing `);`. */
const drizzleBlock = (schema: string, name: string): string => {
  const start = schema.indexOf(`export const ${name} = bmsSchema.table(`);
  if (start < 0) throw new Error(`no ${name} table`);
  const end = schema.indexOf("\n);", start);
  const close = schema.indexOf("\n});", start);
  const stop = [end, close].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return stop === undefined ? schema.slice(start) : schema.slice(start, stop + 4);
};

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.85 migration 0106 — the copilot usage counters and organizations.timezone (ADR 0099 decision 11, Amendment 1 A1, A2)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.copilot_usage (");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bms.copilot_org_usage (");
  });

  it("registers 0106 in the journal one idx after 0105, when above 0105's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0105 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0105's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("takes and returns the owner role around every statement, and writes no GRANT", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(reset, "RESET ROLE not found").toBeGreaterThanOrEqual(0);
    for (const needle of [
      "CREATE TABLE IF NOT EXISTS bms.copilot_usage",
      "CREATE TABLE IF NOT EXISTS bms.copilot_org_usage",
      "ALTER TABLE bms.organizations ADD COLUMN",
      "REVOKE ALL ON",
    ]) {
      const at = sql.indexOf(needle);
      expect(at, `${needle} not found`).toBeGreaterThanOrEqual(0);
      expect(setRole).toBeLessThan(at);
      expect(at).toBeLessThan(reset);
    }
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
  });

  it("adds organizations.timezone as varchar(64) NOT NULL DEFAULT 'UTC'", () => {
    const alter = statementFrom(sql, "ALTER TABLE bms.organizations ADD COLUMN");
    expect(alter).toContain("ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'UTC'");
  });

  it("keys the user counter by (user_id, day) with a cascade and a non-negative turns CHECK", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_usage");
    expect(create).toMatch(/user_id uuid NOT NULL REFERENCES bms\.users\(id\) ON DELETE CASCADE/);
    expect(create).toMatch(/day date NOT NULL/);
    expect(create).toMatch(/turns integer NOT NULL DEFAULT 0 CHECK \(turns >= 0\)/);
    expect(create).toMatch(/PRIMARY KEY \(user_id, day\)/);
    expect(create).not.toMatch(/organization_id/);
  });

  it("keys the organization counter by (organization_id, day) with a cascade and a non-negative turns CHECK", () => {
    const create = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_org_usage");
    expect(create).toMatch(
      /organization_id uuid NOT NULL REFERENCES bms\.organizations\(id\) ON DELETE CASCADE/,
    );
    expect(create).toMatch(/day date NOT NULL/);
    expect(create).toMatch(/turns integer NOT NULL DEFAULT 0 CHECK \(turns >= 0\)/);
    expect(create).toMatch(/PRIMARY KEY \(organization_id, day\)/);
    expect(create).not.toMatch(/user_id/);
  });

  it("forces row level security on both and gives each a strict policy with USING and WITH CHECK", () => {
    for (const table of ["copilot_usage", "copilot_org_usage"]) {
      expect(sql).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
    }
    const user = statementFrom(sql, "CREATE POLICY user_isolation ON bms.copilot_usage");
    expect(user).toContain(`USING (${USER_PREDICATE})`);
    expect(user).toContain(`WITH CHECK (${USER_PREDICATE})`);
    expect(user).not.toMatch(/IS NULL/i);
    const org = statementFrom(sql, "CREATE POLICY tenant_isolation ON bms.copilot_org_usage");
    expect(org).toContain(`USING (${TENANT_PREDICATE})`);
    expect(org).toContain(`WITH CHECK (${TENANT_PREDICATE})`);
    expect(org).not.toMatch(/IS NULL/i);
    // The org counter is the tenant's, not the user's: no user policy on it.
    expect(sql).not.toContain("ON bms.copilot_org_usage\n  USING (user_id");
    expect(sql).not.toMatch(/CREATE POLICY user_isolation ON bms\.copilot_org_usage/);
    expect(sql).not.toMatch(/CREATE POLICY tenant_isolation ON bms\.copilot_usage/);
  });

  it("revokes every privilege on both tables from bms_fleet, and only that", () => {
    const revoke = statementFrom(sql, "REVOKE ALL ON");
    expect(revoke).toMatch(/FROM\s+bms_fleet\s*;$/);
    expect(revoke).toContain("bms.copilot_usage");
    expect(revoke).toContain("bms.copilot_org_usage");
    expect(sql.match(/\bREVOKE\b/gi)).toHaveLength(1);
  });

  it("the drizzle blocks mirror the columns", () => {
    const schema = read(COPILOT_SCHEMA_REL);
    const user = drizzleBlock(schema, "copilotUsage");
    expect(user).toContain('"copilot_usage"');
    expect(user).toMatch(/userId: uuid\("user_id"\)\s*\.notNull\(\)\s*\.references\(\(\) => users\.id, \{ onDelete: "cascade" \}\)/);
    expect(user).toContain('day: date("day").notNull()');
    expect(user).toContain('turns: integer("turns").notNull().default(0)');
    expect(user).toMatch(/primaryKey\(\{ columns: \[t\.userId, t\.day\] \}\)/);
    const org = drizzleBlock(schema, "copilotOrgUsage");
    expect(org).toContain('"copilot_org_usage"');
    expect(org).toMatch(
      /organizationId: uuid\("organization_id"\)\s*\.notNull\(\)\s*\.references\(\(\) => organizations\.id, \{ onDelete: "cascade" \}\)/,
    );
    expect(org).toContain('day: date("day").notNull()');
    expect(org).toContain('turns: integer("turns").notNull().default(0)');
    expect(org).toMatch(/primaryKey\(\{ columns: \[t\.organizationId, t\.day\] \}\)/);
  });

  it("the organizations drizzle table declares timezone", () => {
    const block = drizzleBlock(read(BMS_SCHEMA_REL), "organizations");
    expect(block).toContain('timezone: varchar("timezone", { length: 64 }).notNull().default("UTC")');
  });
});
