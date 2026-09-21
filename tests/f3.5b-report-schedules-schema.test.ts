import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const MIGRATION_REL = "packages/db/drizzle/0078_report_schedules.sql";
const TABLE = "report_schedules";

/** Strip `--` comment lines before a scan — the `f3.1a-dashboard-schema.test.ts`
 * lesson: a raw scan is satisfied by a comment quoting the statement it
 * explains, so a deleted statement stays green as long as a comment still
 * spells it. */
const sqlOnly = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

/** The text of the table's `CREATE POLICY tenant_isolation` statement,
 * terminator included — scoped so a per-table assertion cannot be satisfied
 * by prose elsewhere in the file. */
const policyBlock = (migration: string, table: string): string => {
  const start = migration.indexOf(`CREATE POLICY tenant_isolation ON bms.${table}\n`);
  if (start < 0) throw new Error(`no tenant_isolation policy for bms.${table}`);
  const end = migration.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated tenant_isolation policy for bms.${table}`);
  return migration.slice(start, end + 1);
};

/** The single `ALTER TABLE bms.report_files ADD COLUMN IF NOT EXISTS
 * schedule_id …` statement, terminator included — scoped so the "no ON
 * DELETE" negative cannot be satisfied by absence anywhere else in the file
 * (an unscoped scan would pass for reasons unrelated to this one line). */
const scheduleIdColumnStatement = (migration: string): string => {
  const marker = "ALTER TABLE bms.report_files ADD COLUMN IF NOT EXISTS schedule_id";
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error("no report_files.schedule_id ADD COLUMN statement");
  const end = migration.indexOf(";", start);
  if (end < 0) throw new Error("unterminated schedule_id ADD COLUMN statement");
  return migration.slice(start, end + 1);
};

/** The `channel_id` column line inside `CREATE TABLE bms.report_schedules` —
 * the positive control: it DOES carry `ON DELETE SET NULL`, proving the
 * negative assertion on `schedule_id` is not just an unscoped miss. */
const channelIdColumnLine = (migration: string): string => {
  const marker = "channel_id uuid REFERENCES bms.notification_channels(id)";
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error("no channel_id column declaration");
  const end = migration.indexOf(",", start);
  if (end < 0) throw new Error("unterminated channel_id column declaration");
  return migration.slice(start, end);
};

/**
 * `F3.5b` — the static half of `bms.report_schedules`'s schema guarantees,
 * plus `bms.report_files.schedule_id` (migration `0078`, ADR 0071 decisions
 * 7, 9; F3.5b plan R-13, Q-2).
 *
 * Static rather than behavioural, following `f3.5a-report-files-schema.test.ts`'s
 * own rule (§4.4). Assertions inline, no `.spec` sibling (§4.6).
 */
describe("F3.5b — bms.report_schedules schema, and report_files.schedule_id (migration 0078)", () => {
  it("registers migration 0078 in the journal, after 0077 and before now", () => {
    expect(existsSync(join(repoRoot, MIGRATION_REL)), `${MIGRATION_REL} must exist`).toBe(true);

    const journal = JSON.parse(read("packages/db/drizzle/meta/_journal.json")) as {
      entries: Array<Record<string, unknown>>;
    };
    const entry = journal.entries.find((e) => e.tag === "0078_report_schedules");

    expect(entry, "migration 0078 must have a journal entry, or drizzle never runs it").toBeDefined();
    expect(entry?.idx).toBe(78);
    expect(entry?.tag).toBe("0078_report_schedules");
    // 0077's `when` — the F4.94 class: a stamp ahead of the wall clock sorts
    // after a later real-clock stamp and is silently skipped wherever the
    // later one applies.
    expect(entry?.when as number).toBeGreaterThan(1789972403791);
    expect(entry?.when as number).toBeLessThan(Date.now());
  });

  it("is not scanning an empty or misnamed file", () => {
    const migration = read(MIGRATION_REL);
    expect(migration.length).toBeGreaterThan(1000);
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS bms.${TABLE}`);
  });

  it("brackets the whole migration in SET ROLE bms_owner / RESET ROLE", () => {
    const migration = read(MIGRATION_REL);
    expect(sqlOnly(migration)).toContain("SET ROLE bms_owner;");
    expect(sqlOnly(migration)).toContain("RESET ROLE;");
  });

  it("never uses CREATE INDEX CONCURRENTLY", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/CREATE INDEX CONCURRENTLY/i);
  });

  it("gives organization_id NOT NULL", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("organization_id uuid NOT NULL REFERENCES bms.organizations(id)");
  });

  it("enables and forces row level security", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(migration).toContain(`ALTER TABLE bms.${TABLE} FORCE ROW LEVEL SECURITY;`);
  });

  it("the policy checks the own organization_id column, in USING and in WITH CHECK, with no NULL disjunct", () => {
    const migration = read(MIGRATION_REL);
    const policy = policyBlock(migration, TABLE);
    const split = policy.indexOf("WITH CHECK");
    expect(split, "the policy must carry a WITH CHECK clause").toBeGreaterThan(0);
    const using = policy.slice(0, split);
    const withCheck = policy.slice(split);

    for (const [name, half] of [["USING", using], ["WITH CHECK", withCheck]] as const) {
      expect(half, `${name} must check the own organization_id`).toContain(
        "organization_id = nullif(current_setting('app.current_organization', true), '')::uuid",
      );
    }
    expect(policy).not.toMatch(/IS NULL/i);
  });

  it("issues no GRANT statement — 0041's default privileges do it", () => {
    expect(sqlOnly(read(MIGRATION_REL))).not.toMatch(/\bGRANT\b/i);
  });

  it("names all four report_schedules CHECK constraints", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    for (const name of [
      "CONSTRAINT report_schedules_name_check",
      "CONSTRAINT report_schedules_formats_check",
      "CONSTRAINT report_schedules_cadence_check",
      "CONSTRAINT report_schedules_run_at_minute_check",
    ]) {
      expect(migration, `${name} must be named, not derived`).toContain(name);
    }
  });

  it("channel_id is ON DELETE SET NULL", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    const channelIdLine = channelIdColumnLine(migration);
    expect(channelIdLine).toContain("ON DELETE SET NULL");
  });

  it("report_files.schedule_id references report_schedules with no ON DELETE clause — NO ACTION, the Postgres default, refuses the delete exactly as R-13/Q-2's RESTRICT ruling requires (the constraint is not deferrable, so the two are indistinguishable here)", () => {
    const migration = sqlOnly(read(MIGRATION_REL));

    // The claim under test, first: no ON DELETE on schedule_id.
    const scheduleIdStatement = scheduleIdColumnStatement(migration);
    expect(scheduleIdStatement).toContain("REFERENCES bms.report_schedules(id)");
    expect(scheduleIdStatement).not.toMatch(/ON DELETE/i);

    // Positive control, second: the same migration DOES write ON DELETE
    // elsewhere (channel_id), so the negative above is not an artefact of a
    // migration that never writes ON DELETE at all.
    const channelIdLine = channelIdColumnLine(migration);
    expect(channelIdLine).toContain("ON DELETE SET NULL");
  });

  it("creates the partial unique idempotency index, exact text", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS report_files_schedule_period_format_key ON bms.report_files (schedule_id, period_end, format) WHERE schedule_id IS NOT NULL",
    );
  });

  it("creates the prune-read index, scoped to scheduled rows", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain(
      "CREATE INDEX IF NOT EXISTS report_files_schedule_created_idx ON bms.report_files (schedule_id, created_at DESC) WHERE schedule_id IS NOT NULL",
    );
  });

  it("creates the due-row index, scoped to enabled schedules", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS report_schedules_due_idx ON bms.report_schedules (next_run_at) WHERE enabled");
  });

  it("creates the organization/created_at index", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS report_schedules_org_created_idx");
  });

  it("carries no timezone or template_id CHECK", () => {
    const migration = sqlOnly(read(MIGRATION_REL));
    expect(migration).not.toMatch(/report_schedules_timezone_check/i);
    expect(migration).not.toMatch(/report_schedules_template_id_check/i);
  });
});
