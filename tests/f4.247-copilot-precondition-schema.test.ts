import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.247` / ADR 0099 Amendment 5 C1 — migration `0115` adds
 * `bms.copilot_pending_changes.precondition`, a nullable `varchar(40)`: the target
 * row's `updated_at` (ms ISO) read at propose time, which the Confirm's `If-Match`
 * must name. NULL for an entry with no precondition.
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f4.267-vision-model-migration`
 * model. The integration suite round-trips the column through `propose` and `claim`;
 * this file pins the text, so a dropped `IF NOT EXISTS`, a `NOT NULL`/`DEFAULT`, or
 * a policy statement slipped into the file is red without a database.
 */
const MIGRATION_TAG = "0115_copilot_pending_changes_precondition";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0114_point_keys_created_by_organization";

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

const ADD_COLUMN = "ALTER TABLE bms.copilot_pending_changes ADD COLUMN";

describe("F4.247 migration 0115 — copilot_pending_changes.precondition (ADR 0099 Amendment 5 C1)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("ALTER TABLE bms.copilot_pending_changes");
  });

  it("registers 0115 in the journal one idx after 0114, when above 0114's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0114 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0114's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("adds the column as a nullable varchar(40) with no default, idempotently", () => {
    const alter = statementFrom(sql, ADD_COLUMN);
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS precondition varchar\(40\);/);
    expect(alter).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it("documents the column in the catalog", () => {
    const comment = statementFrom(sql, "COMMENT ON COLUMN bms.copilot_pending_changes.precondition");
    expect(comment).toContain("Amendment 5 C1");
  });

  it("runs as the owner and changes no policy, privilege or row", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    const alterAt = sql.indexOf(ADD_COLUMN);
    expect(setRole).toBeLessThan(alterAt);
    expect(alterAt).toBeLessThan(reset);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM)\b/);
    expect(migration).not.toContain("statement-breakpoint");
  });

  it("declares the column on the drizzle table right after resourceId", () => {
    const schema = read(SCHEMA_REL);
    const start = schema.indexOf('export const copilotPendingChanges = bmsSchema.table(');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = schema.slice(start, schema.indexOf("\n);", start));
    expect(block).toMatch(
      /resourceId: varchar\("resource_id", \{ length: 128 \}\),\s*(?:\/\/[^\n]*\n\s*)?precondition: varchar\("precondition", \{ length: 40 \}\),/,
    );
  });
});
