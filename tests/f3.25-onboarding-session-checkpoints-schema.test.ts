import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.25` / ADR 0094 decision 2 — migration `0101` adds a nullable
 * `checkpoints jsonb` to `bms.onboarding_sessions`: the ring of the last 10
 * draft checkpoints. Table-level RLS (0040/0041) is unchanged, so the file has
 * no GRANT, REVOKE, POLICY or ROW LEVEL SECURITY.
 *
 * Assertions inline, no `.spec` sibling (§4.6 carve-out for `tests/`); the
 * model is `tests/f3.21-organization-llm-settings-schema.test.ts`.
 */
const MIGRATION_TAG = "0101_onboarding_session_checkpoints";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
/** 0100's journal `when`. */
const PREVIOUS_WHEN = 1791020601045;
const ALTER = "ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS checkpoints jsonb;";

/** Comments stripped, so a header quoting the body cannot satisfy an assertion. */
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

/** The drizzle table literal, from its declaration to the closing `});`. */
const drizzleBlock = (schema: string): string => {
  const start = schema.indexOf("export const onboardingSessions = bmsSchema.table(");
  if (start < 0) throw new Error(`no onboardingSessions table in ${SCHEMA_REL}`);
  const end = schema.indexOf("\n});", start);
  return end < 0 ? schema.slice(start) : schema.slice(start, end + 4);
};

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.25 migration 0101 — bms.onboarding_sessions.checkpoints (ADR 0094 decision 2)", () => {
  it("adds the checkpoints column idempotently", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain(ALTER);
  });

  it("makes the column nullable with no default", () => {
    const statement = statementFrom(sql, "ALTER TABLE bms.onboarding_sessions ADD COLUMN");
    expect(statement).not.toMatch(/NOT\s+NULL/i);
    expect(statement).not.toMatch(/\bDEFAULT\b/i);
  });

  it("changes no privilege and no policy (table-level RLS from 0040/0041 stands)", () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });

  it("runs the body between SET ROLE bms_owner and RESET ROLE", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const alter = sql.indexOf(ALTER);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole, "SET ROLE bms_owner not found").toBeGreaterThanOrEqual(0);
    expect(reset, "RESET ROLE not found").toBeGreaterThanOrEqual(0);
    expect(setRole).toBeLessThan(alter);
    expect(alter).toBeLessThan(reset);
  });

  it("registers 0101 in the journal as idx 102, when above 0100's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(entry?.idx).toBe(102);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0100's, or drizzle applies nothing",
    ).toBeGreaterThan(PREVIOUS_WHEN);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("the drizzle onboardingSessions block declares checkpoints as a nullable jsonb", () => {
    const block = drizzleBlock(read(SCHEMA_REL));
    const line = block.split("\n").find((l) => l.includes('checkpoints: jsonb("checkpoints")'));
    expect(line, 'checkpoints: jsonb("checkpoints") not found').toBeDefined();
    expect(line).not.toContain(".notNull()");
  });
});
