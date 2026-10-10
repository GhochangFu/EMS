import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.85` PR 3 / ADR 0099 decision 5 — migration `0104` creates the three
 * copilot availability tables: the organization switch
 * (`bms.copilot_org_settings`), the two scoped-role switches
 * (`bms.copilot_role_settings`) and the named-user exceptions
 * (`bms.copilot_user_overrides`). No row means off for the organization
 * (ruling 15) and on for a role (plan Q2).
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.21` model. What
 * Postgres enforces (the tenant boundary, the role CHECK, the cascades) is
 * `apps/api/src/copilot/copilot-access.rls.integration.spec.ts`'s job; this
 * file pins the text, so a deleted `FORCE` or `WITH CHECK` is red here without
 * a database.
 */
const MIGRATION_TAG = "0104_copilot_access";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0103_location_tree";

const TABLES = ["copilot_org_settings", "copilot_role_settings", "copilot_user_overrides"] as const;

/** The strict tenant predicate (the 0050 rule: no `IS NULL` disjunct). */
const TENANT_PREDICATE =
  "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion
 * about a statement that was actually deleted (`f3.1a`'s lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** One statement, from `start` to its `;`, so a clause in a neighbour cannot decide a claim. */
const statementFrom = (sql: string, start: string): string => {
  const at = sql.indexOf(start);
  if (at < 0) throw new Error(`no "${start}" in the migration`);
  const end = sql.indexOf(";", at);
  return end < 0 ? sql.slice(at) : sql.slice(at, end + 1);
};

/** One drizzle table literal, from its declaration to the table's closing `);`. */
const drizzleBlock = (schema: string, name: string): string => {
  const start = schema.indexOf(`export const ${name} = bmsSchema.table(`);
  if (start < 0) throw new Error(`no ${name} table in ${SCHEMA_REL}`);
  const end = schema.indexOf("\n);", start);
  const close = schema.indexOf("\n});", start);
  const stop = [end, close].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return stop === undefined ? schema.slice(start) : schema.slice(start, stop + 4);
};

const columnsOf = (block: string): string[] =>
  [...block.matchAll(/^\s+\w+: (\w+)\("(\w+)"/gm)].map((m) => m[2]);

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.85 migration 0104 — the copilot availability tables (ADR 0099 decision 5)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS bms.${table} (`);
    }
  });

  it("registers 0104 in the journal one idx after 0103, when above 0103's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0103 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0103's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("takes and returns the owner role, and writes no GRANT or REVOKE", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(reset, "RESET ROLE not found").toBeGreaterThanOrEqual(0);
    for (const table of TABLES) {
      const create = sql.indexOf(`CREATE TABLE IF NOT EXISTS bms.${table}`);
      expect(setRole).toBeLessThan(create);
      expect(create).toBeLessThan(reset);
    }
    // The 0100 model: 0041's default privileges reach the pool roles.
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
  });

  it("keys each table by its organization and cascades with it", () => {
    const org = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_org_settings");
    expect(org).toMatch(
      /organization_id uuid PRIMARY KEY REFERENCES bms\.organizations\(id\) ON DELETE CASCADE/,
    );
    expect(org).toMatch(/enabled boolean NOT NULL DEFAULT false/);

    const role = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_role_settings");
    expect(role).toMatch(
      /organization_id uuid NOT NULL REFERENCES bms\.organizations\(id\) ON DELETE CASCADE/,
    );
    expect(role).toMatch(/PRIMARY KEY \(organization_id, role\)/);

    const user = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_user_overrides");
    expect(user).toMatch(
      /organization_id uuid NOT NULL REFERENCES bms\.organizations\(id\) ON DELETE CASCADE/,
    );
    expect(user).toMatch(/user_id uuid NOT NULL REFERENCES bms\.users\(id\) ON DELETE CASCADE/);
    expect(user).toMatch(/allow boolean NOT NULL/);
    expect(user).toMatch(/PRIMARY KEY \(organization_id, user_id\)/);
  });

  it("limits a role switch to the two scoped admin roles by a named CHECK", () => {
    const role = statementFrom(sql, "CREATE TABLE IF NOT EXISTS bms.copilot_role_settings");
    expect(role).toMatch(
      /CONSTRAINT copilot_role_settings_role_check CHECK \(role IN \('location_admin', ?'asset_group_admin'\)\)/,
    );
  });

  it.each(TABLES)(
    "enables and forces row level security on %s with a strict tenant_isolation policy",
    (table) => {
      expect(sql).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`DROP POLICY IF EXISTS tenant_isolation ON bms.${table};`);
      const policy = statementFrom(sql, `CREATE POLICY tenant_isolation ON bms.${table}`);
      expect(policy).toContain(`USING (${TENANT_PREDICATE})`);
      expect(policy).toContain(`WITH CHECK (${TENANT_PREDICATE})`);
      expect(policy).not.toMatch(/IS NULL/i);
      expect(policy).not.toMatch(/\bTO\s+bms_/i);
      expect(sql).toContain(`COMMENT ON TABLE bms.${table} IS`);
    },
  );

  it("mirrors the three tables in drizzle with the same columns", () => {
    const schema = read(SCHEMA_REL);
    expect(columnsOf(drizzleBlock(schema, "copilotOrgSettings"))).toEqual([
      "organization_id",
      "enabled",
      "updated_by",
      "updated_at",
    ]);
    expect(columnsOf(drizzleBlock(schema, "copilotRoleSettings"))).toEqual([
      "organization_id",
      "role",
      "enabled",
      "updated_by",
      "updated_at",
    ]);
    expect(columnsOf(drizzleBlock(schema, "copilotUserOverrides"))).toEqual([
      "organization_id",
      "user_id",
      "allow",
      "updated_by",
      "updated_at",
    ]);
    expect(read("packages/db/src/schema/index.ts")).toContain('export * from "./copilot-schema";');
  });
});
