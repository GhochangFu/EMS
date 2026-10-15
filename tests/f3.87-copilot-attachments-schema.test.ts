import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F3.87` PR 3 / ADR 0099 Amendment 3 A7 — migration `0110` adds the
 * per-organization attachment switch: `bms.copilot_org_settings.attachments_enabled`,
 * a `boolean NOT NULL DEFAULT false`. Off by default; it counts only while the
 * organization's `enabled` is true (`CopilotAvailabilityService.attachmentsOn`).
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f3.86-copilot-skill-schema`
 * model. What Postgres enforces is the cold start and the copilot access RLS
 * suite; this file pins the text, so a dropped `IF NOT EXISTS`, a `DEFAULT true`
 * or a policy statement slipped into the file is red without a database.
 */
const MIGRATION_TAG = "0110_copilot_attachments";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const COPILOT_SCHEMA_REL = "packages/db/src/schema/copilot-schema.ts";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0109_network_mimics_switching_units";

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

describe("F3.87 migration 0110 — copilot_org_settings.attachments_enabled (ADR 0099 Amendment 3 A7)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("ALTER TABLE bms.copilot_org_settings");
  });

  it("registers 0110 in the journal one idx after 0109, when above 0109's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous, "0109 is the baseline this test orders against").toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(
      entry?.when ?? 0,
      "F4.94: journal when must be strictly greater than 0109's, or drizzle applies nothing",
    ).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(
      entry?.when ?? Number.POSITIVE_INFINITY,
      "F4.94: a journal `when` ahead of the clock is repaired by hand, never deleted",
    ).toBeLessThanOrEqual(Date.now());
  });

  it("adds the column as boolean NOT NULL DEFAULT false, idempotently", () => {
    const alter = statementFrom(sql, "ALTER TABLE bms.copilot_org_settings");
    expect(alter).toMatch(/ADD COLUMN IF NOT EXISTS attachments_enabled boolean NOT NULL DEFAULT false;/);
  });

  it("documents the column in the catalog", () => {
    const comment = statementFrom(sql, "COMMENT ON COLUMN bms.copilot_org_settings.attachments_enabled");
    expect(comment).toContain("Amendment 3 A7");
  });

  it("runs as the owner and changes no policy, privilege or row", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    const alterAt = sql.indexOf("ALTER TABLE bms.copilot_org_settings");
    expect(setRole).toBeLessThan(alterAt);
    expect(alterAt).toBeLessThan(reset);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM)\b/);
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(migration).not.toContain("statement-breakpoint");
  });

  it("declares the column on the drizzle table with the same default", () => {
    const schema = read(COPILOT_SCHEMA_REL);
    const start = schema.indexOf('export const copilotOrgSettings = bmsSchema.table("copilot_org_settings"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = schema.slice(start, schema.indexOf("\n});", start));
    expect(block).toMatch(
      /attachmentsEnabled: boolean\("attachments_enabled"\)\.notNull\(\)\.default\(false\)/,
    );
  });
});
