import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.339` / ADR 0117 decision 9 (plan T4.2, R12, ruling Q7) — migration `0132` adds three
 * nullable lock columns to `bms.onboarding_sessions`: `locked_at`, `locked_by` (a plain uuid, no
 * FK) and `lock_reason`. Table-level RLS (0040/0041) is unchanged, so the file has no GRANT,
 * REVOKE, POLICY or ROW LEVEL SECURITY. Assertions inline (§4.6 carve-out for `tests/`); the model
 * is `tests/f3.25-onboarding-session-checkpoints-schema.test.ts`.
 */
const MIGRATION_TAG = "0132_onboarding_session_lock";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
const SCHEMA_REL = "packages/db/src/schema/bms-schema.ts";
const ALTERS = [
  "ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS locked_at timestamptz;",
  "ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS locked_by uuid;",
  "ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS lock_reason varchar(500);",
] as const;

/** Comments stripped, so a header quoting the body cannot satisfy an assertion. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

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

describe("F4.339 migration 0132 — bms.onboarding_sessions lock columns (ADR 0117 decision 9)", () => {
  it("holds exactly the three column adds between SET ROLE and RESET ROLE", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql.split(";").filter((s) => s.trim().length > 0).length).toBe(5);
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    for (const alter of ALTERS) {
      const at = sql.indexOf(alter);
      expect(at, alter).toBeGreaterThan(setRole);
      expect(at, alter).toBeLessThan(reset);
    }
  });

  it("makes every column nullable with no default and no foreign key (ruling Q7)", () => {
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/\bDEFAULT\b/i);
    expect(sql).not.toMatch(/\bREFERENCES\b/i);
    expect(sql).not.toMatch(/FOREIGN\s+KEY/i);
  });

  it("changes no privilege and no policy (table-level RLS from 0040/0041 stands)", () => {
    expect(sql).not.toMatch(/\bGRANT\b/i);
    expect(sql).not.toMatch(/\bREVOKE\b/i);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });

  it("registers 0132 in the journal as idx 133, after 0131 and not ahead of now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as { entries: Array<Record<string, unknown>> };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const prev = journal.entries.find((e) => e.tag === "0131_rtu_released_mqtt_topic");
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(entry?.idx).toBe(133);
    expect(entry?.version).toBe("7");
    expect(entry?.breakpoints).toBe(true);
    expect(entry?.when as number).toBeGreaterThan(prev?.when as number);
    expect(entry?.when as number).toBeLessThanOrEqual(Date.now());
  });

  it("declares the three Drizzle columns inside onboardingSessions", () => {
    const block = drizzleBlock(read(SCHEMA_REL));
    expect(block).toContain('lockedAt: timestamp("locked_at", { withTimezone: true })');
    expect(block).toContain('lockedBy: uuid("locked_by")');
    expect(block).toContain('lockReason: varchar("lock_reason", { length: 500 })');
    expect(block).not.toMatch(/lockedBy: uuid\("locked_by"\)\.references/);
  });
});
