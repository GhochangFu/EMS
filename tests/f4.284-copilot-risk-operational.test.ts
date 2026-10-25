import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

/**
 * `F4.284` / ADR 0106 — migration `0116` widens
 * `copilot_pending_changes_risk_check` with the fifth risk class,
 * `operational` (an alarm acknowledge or a work-order close: red, and it
 * cannot be undone).
 *
 * **Assertions inline, no `.spec` sibling** — the `tests/f4.247` model. The
 * integration suite inserts an `operational` row; this file pins the text, and
 * that the shared enum holds the same five values the CHECK does.
 */
const MIGRATION_TAG = "0116_copilot_pending_changes_risk_operational";
const MIGRATION_REL = `packages/db/drizzle/${MIGRATION_TAG}.sql`;
const JOURNAL_REL = "packages/db/drizzle/meta/_journal.json";
/** Read by tag: the journal's idx is offset from the file number since 0098. */
const PREVIOUS_TAG = "0115_copilot_pending_changes_precondition";
const FIVE = ["create", "edit", "deactivate", "access", "operational"];

/** `@bms/shared` through `createRequire` (it reads `packages/shared/dist`; rebuild it after an edit). */
const require_ = createRequire(import.meta.url);
const { copilotChangeRiskSchema } = require_("@bms/shared") as {
  copilotChangeRiskSchema: { options: readonly string[] };
};

const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

const migrationPath = join(repoRoot, MIGRATION_REL);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const sql = sqlOnly(migration);

describe("F4.284 migration 0116 — copilot_pending_changes_risk_check gains operational (ADR 0106)", () => {
  it("is not scanning an empty or misnamed file", () => {
    expect(existsSync(migrationPath), `${MIGRATION_REL} not found`).toBe(true);
    expect(sql).toContain("ALTER TABLE bms.copilot_pending_changes");
  });

  it("registers 0116 in the journal one idx after 0115, when above 0115's and not above now", () => {
    const journal = JSON.parse(read(JOURNAL_REL)) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    const previous = journal.entries.find((e) => e.tag === PREVIOUS_TAG);
    expect(entry, "drizzle silently skips a migration with no journal row").toBeDefined();
    expect(previous).toBeDefined();
    expect(entry?.idx).toBe((previous?.idx ?? Number.NaN) + 1);
    expect(entry?.when ?? 0).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
    expect(entry?.when ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(Date.now());
  });

  it("drops the old CHECK idempotently", () => {
    expect(sql).toContain(
      "ALTER TABLE bms.copilot_pending_changes DROP CONSTRAINT IF EXISTS copilot_pending_changes_risk_check;",
    );
  });

  it("adds the CHECK back with the five risk classes", () => {
    expect(sql).toContain(
      "ALTER TABLE bms.copilot_pending_changes ADD CONSTRAINT copilot_pending_changes_risk_check CHECK (risk IN ('create','edit','deactivate','access','operational'));",
    );
  });

  it("runs as the owner and creates no table, policy, privilege or row", () => {
    const setRole = sql.search(/\bSET\s+ROLE\s+bms_owner\s*;/);
    const reset = sql.search(/\bRESET\s+ROLE\s*;/);
    expect(setRole).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(setRole);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bPOLICY\b/i);
    expect(sql).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE FROM)\b/);
  });

  it("holds the same five values as the shared risk enum", () => {
    expect([...copilotChangeRiskSchema.options]).toEqual(FIVE);
  });
});
