import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0098_user_administration.sql";
const TAG = "0098_user_administration";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
/** 0097's journal `when` — 0098 must sort after it (the F4.94 class). */
const WHEN_0097 = 1790876326348;

/** Strip `--` comment lines before a scan — a raw scan is satisfied by a comment
 * that quotes the statement it explains (the `f3.1a-dashboard-schema.test.ts` lesson). */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migration = (): string => sqlOnly(read(MIGRATION_REL));

/** The column list of the one `GRANT INSERT (...) ON bms.users` statement. */
const insertGrantColumns = (sql: string): string[] => {
  const m = /GRANT INSERT \(([^)]*)\)\s+ON bms\.users\s+TO ([^;]*);/.exec(sql);
  if (!m) return [];
  return (m[1] as string).split(",").map((c) => c.trim());
};

/** The body of `bms.users_guard_oidc_subject()`, between its dollar quotes. */
const triggerFunctionBody = (sql: string): string => {
  const m = /CREATE OR REPLACE FUNCTION bms\.users_guard_oidc_subject\(\)[\s\S]*?AS \$fn\$([\s\S]*?)\$fn\$/.exec(sql);
  return m?.[1] ?? "";
};

/** The `users` table block of the Drizzle schema. */
const usersTableBlock = (): string => {
  const m = /export const users = bmsSchema\.table\("users", \{([\s\S]*?)\n\}\);/.exec(read(SCHEMA_REL));
  return m?.[1] ?? "";
};

/**
 * `F3.78` / ADR 0089 — the static half of migration `0098` (plan U1).
 * `tests/f3.78-user-administration-schema.integration.test.ts` asserts what
 * Postgres enforces. Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.78 — migration 0098: user administration grants, CHECK, indexes, trigger and grant-table RLS", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);
    expect(read(MIGRATION_REL).length).toBeGreaterThan(1000);
    expect(migration()).toContain("ALTER TABLE bms.users");
  });

  it("registers migration 0098 in the journal, after 0097 and before now", () => {
    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, "migration 0098 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(98);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(WHEN_0097);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("drops NOT NULL on bms.users.password_hash", () => {
    expect(migration()).toMatch(/ALTER TABLE bms\.users ALTER COLUMN password_hash DROP NOT NULL;/);
  });

  it("grants the column INSERT on exactly the seven non-secret columns, never password_hash", () => {
    const sql = migration();
    expect(insertGrantColumns(sql).sort()).toEqual(
      ["created_at", "display_name", "email", "id", "oidc_subject", "organization_id", "role"],
    );
    expect(sql).toMatch(/GRANT INSERT \([^)]*\)\s+ON bms\.users\s+TO bms_tenant, bms_fleet;/);
    expect(sql).not.toMatch(/GRANT INSERT[^;]*password_hash/);
    expect(sql).not.toMatch(/GRANT INSERT ON bms\.users/);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*ON bms\.users/);
  });

  it("revokes UPDATE (email, oidc_subject) from both pool roles", () => {
    expect(migration()).toMatch(/REVOKE UPDATE \(email, oidc_subject\) ON bms\.users FROM bms_tenant, bms_fleet;/);
  });

  it("grants UPDATE (oidc_subject) to bms_auth", () => {
    expect(migration()).toMatch(/GRANT UPDATE \(oidc_subject\) ON bms\.users TO bms_auth;/);
  });

  it("adds the admin/organization CHECK as users_role_organization_check", () => {
    expect(migration()).toMatch(
      /ADD CONSTRAINT users_role_organization_check CHECK \(\(role = 'admin'\) = \(organization_id IS NULL\)\)/,
    );
  });

  it("creates the case-insensitive email index and the subject index, both unique", () => {
    const sql = migration();
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON bms\.users \(lower\(email\)\);/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS users_oidc_subject_uidx ON bms\.users \(oidc_subject\);/);
  });

  it("tests current_user, not session_user, in the subject trigger function", () => {
    const body = triggerFunctionBody(migration());
    expect(body, "0098 must define bms.users_guard_oidc_subject() with $fn$ quotes").not.toBe("");
    expect(body).toMatch(/rolname = current_user/);
    expect(body).not.toMatch(/session_user/);
    expect(body).toMatch(/integrity_constraint_violation/);
    expect(migration()).not.toMatch(/SECURITY DEFINER/i);
  });

  it("binds the trigger BEFORE UPDATE OF oidc_subject", () => {
    expect(migration()).toMatch(
      /CREATE TRIGGER users_oidc_subject_guard\s+BEFORE UPDATE OF oidc_subject ON bms\.users\s+FOR EACH ROW EXECUTE FUNCTION bms\.users_guard_oidc_subject\(\);/,
    );
  });

  it.each(["user_location_access", "user_asset_group_access"])("ENABLEs and FORCEs row-level security on bms.%s", (table) => {
    const sql = migration();
    expect(sql).toContain(`ALTER TABLE bms.${table} ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`ALTER TABLE bms.${table} FORCE ROW LEVEL SECURITY;`);
    expect(sql).toContain(`CREATE POLICY tenant_isolation ON bms.${table}`);
  });

  it("runs both pre-check DO blocks before the first SET ROLE bms_owner, with their messages", () => {
    const sql = migration();
    const setRole = sql.indexOf("SET ROLE bms_owner;");
    const collide = sql.indexOf("collide case-insensitively");
    const adminRule = sql.indexOf("admin/organization rule");
    expect(setRole).toBeGreaterThan(-1);
    expect(collide, "pre-check A's message must be present").toBeGreaterThan(-1);
    expect(adminRule, "pre-check B's message must be present").toBeGreaterThan(-1);
    expect(collide).toBeLessThan(setRole);
    expect(adminRule).toBeLessThan(setRole);
    // Both messages sit inside a DO block that opens before SET ROLE.
    const firstDo = sql.indexOf("DO $$");
    expect(firstDo).toBeGreaterThan(-1);
    expect(firstDo).toBeLessThan(collide);
  });

  it("ends with RESET ROLE", () => {
    expect(migration().trimEnd().endsWith("RESET ROLE;")).toBe(true);
  });

  it("declares password_hash nullable and disabled_at in the Drizzle schema", () => {
    const block = usersTableBlock();
    expect(block, `${SCHEMA_REL} must declare the users table`).not.toBe("");
    const hashLine = block.split("\n").find((l) => l.includes("passwordHash:"));
    expect(hashLine).toBeDefined();
    expect(hashLine).not.toMatch(/\.notNull\(\)/);
    expect(block).toMatch(/disabledAt: timestamp\("disabled_at", \{ withTimezone: true \}\)/);
  });
});
