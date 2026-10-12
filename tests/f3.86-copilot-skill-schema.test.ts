import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.86` PR 5 / ADR 0099 decision 7 — migration `0107` binds a copilot
 * conversation to an onboarding session (the onboarding skill):
 * `bms.copilot_conversations.onboarding_session_id`, a nullable foreign key to
 * `bms.onboarding_sessions` with `ON DELETE SET NULL`, and a partial index.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.21` model. What
 * Postgres enforces is the cold start and the copilot integration suites;
 * this file pins the text, so a dropped `IF NOT EXISTS` or a policy statement
 * slipped into the file is red without a database.
 */
const MIGRATION_TAG = "0107_copilot_skill";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const COPILOT_SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0106_copilot_usage";

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

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F3.86 migration 0107 — copilot_conversations.onboarding_session_id (ADR 0099 decision 7)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("ALTER TABLE bms.copilot_conversations");
  });

  it("registers 0107 in the journal one idx after 0106, when above 0106's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0106 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0106's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("adds the column as a nullable uuid referencing onboarding_sessions, ON DELETE SET NULL, idempotently", () => {
    const alter = statementFrom(sql, "ALTER TABLE bms.copilot_conversations");
    expect(alter).toMatch(
      /ADD COLUMN IF NOT EXISTS onboarding_session_id uuid\s+REFERENCES bms\.onboarding_sessions\(id\) ON DELETE SET NULL;/,
    );
    expect(alter).not.toMatch(/NOT NULL/);
  });

  it("indexes the bound rows only, idempotently", () => {
    const index = statementFrom(sql, "CREATE INDEX IF NOT EXISTS copilot_conversations_onboarding_session_idx");
    expect(index).toContain("ON bms.copilot_conversations (onboarding_session_id)");
    expect(index).toContain("WHERE onboarding_session_id IS NOT NULL");
  });

  it("runs as the owner and changes no policy, privilege or row", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    const alterAt = sql.indexOf("ALTER TABLE bms.copilot_conversations");
    expect(setRole).toBeLessThan(alterAt);
    expect(alterAt).toBeLessThan(reset);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM)\b/);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
  });

  it("declares the column on the drizzle table with the same reference and delete rule", () => {
    const schema = read(COPILOT_SCHEMA_REL);
    const start = schema.indexOf("export const copilotConversations = bmsSchema.table(");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = schema.slice(start, schema.indexOf("\n);", start));
    expect(block).toMatch(
      /onboardingSessionId: uuid\("onboarding_session_id"\)\.references\(\(\) => onboardingSessions\.id, \{ onDelete: "set null" \}\)/,
    );
  });
});
