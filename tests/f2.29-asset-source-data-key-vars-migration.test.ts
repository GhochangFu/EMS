import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F2.29` / ADR 0039 Amendment 1 decision 1 — `bms.assets.source_data_key_vars`,
 * migration `0102`: a nullable jsonb column holding the `{token}` variables an
 * instantiation request supplied, with a CHECK that it is NULL or a JSON object,
 * and no policy or grant change (RLS on `bms.assets` is table-level, 0047).
 * Model: `tests/adr-0056-point-metadata-migration.test.ts`.
 *
 * **Assertions inline, no `.spec` sibling** — the top-level `tests/` carve-out
 * (§4.6).
 */
const STEM = "0102_asset_source_data_key_vars";
const MIGRATION_REL = `packages/db/drizzle/${STEM}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";

/** Comments stripped before every assertion — a header quoting DDL must not hold a `toContain` green. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

type JournalEntry = { idx: number; when: number; tag: string };
const journalEntries = (): ReadonlyArray<JournalEntry> =>
  (JSON.parse(read(JOURNAL_REL)) as { entries: ReadonlyArray<JournalEntry> }).entries;

describe("F2.29 — migration 0102 adds bms.assets.source_data_key_vars", () => {
  it("adds the column as nullable jsonb", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      "ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS source_data_key_vars jsonb;",
    );
  });

  it("does not give the column a NOT NULL or a DEFAULT — NULL means built before F2.29 or with no variables", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/source_data_key_vars jsonb (NOT NULL|DEFAULT)/i);
  });

  it("adds the named CHECK that the column is NULL or a JSON object", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      "ADD CONSTRAINT assets_source_data_key_vars_object_check CHECK " +
        "(source_data_key_vars IS NULL OR jsonb_typeof(source_data_key_vars) = 'object')",
    );
  });

  it("guards the ADD CONSTRAINT with a pg_constraint probe, so a second run is a no-op", () => {
    expect(sqlOnly(read(MIGRATION_REL))).toContain(
      "IF NOT EXISTS ( SELECT 1 FROM pg_constraint " +
        "WHERE conname = 'assets_source_data_key_vars_object_check' " +
        "AND conrelid = 'bms.assets'::regclass ) THEN",
    );
  });

  it("changes no policy and no privilege", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
  });

  it("runs as bms_owner and resets the role", () => {
    const sql = sqlOnly(read(MIGRATION_REL));
    expect(sql).toContain("SET ROLE bms_owner;");
    expect(sql).toContain("RESET ROLE;");
  });
});

describe("F2.29 — migration 0102 is journalled", () => {
  it("has a journal entry whose tag equals the filename stem", () => {
    const entry = journalEntries().find((e) => e.tag === STEM);
    expect(
      entry,
      `no journal entry with tag "${STEM}" — drizzle skips an unjournalled .sql file silently`,
    ).toBeDefined();
  });

  it("stamps a when strictly greater than 0101's", () => {
    const entries = journalEntries();
    const previous = entries.find((e) => e.tag === "0101_onboarding_session_checkpoints");
    const entry = entries.find((e) => e.tag === STEM);
    expect(previous, "journal entry 0101_onboarding_session_checkpoints not found").toBeDefined();
    expect(entry?.when).toBeGreaterThan(previous!.when);
  });

  it("stamps a when that is not ahead of the clock (AGENTS.md §4.4)", () => {
    const entry = journalEntries().find((e) => e.tag === STEM);
    expect(entry?.when).toBeLessThanOrEqual(Date.now());
  });
});

describe("F2.29 — the Drizzle schema declares the column", () => {
  it("bms-schema.ts maps sourceDataKeyVars to source_data_key_vars as jsonb", () => {
    expect(read(SCHEMA_REL)).toMatch(/sourceDataKeyVars: jsonb\("source_data_key_vars"\)/);
  });
});
